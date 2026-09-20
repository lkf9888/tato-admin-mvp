import "server-only";

import { randomBytes } from "crypto";

import { prisma } from "@/lib/prisma";

/**
 * Channels and who is watching them.
 *
 * A channel is the routing unit and nothing more. The hub has no user
 * directory: it never learns that a subscriber is a cleaner or which
 * flat they are at, only that this openid gets what is sent to
 * `hosthub.cleaning`. That ignorance is the isolation -- an app that
 * is sold to someone else brings its own channels and its own people,
 * and no two apps can read each other's.
 */

// No I/O/0/1 confusion: this gets read aloud across a car park.
const CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

export function createBindCode() {
  const bytes = randomBytes(8);
  let code = "";
  for (let index = 0; index < 8; index += 1) {
    code += CODE_ALPHABET[bytes[index] % CODE_ALPHABET.length];
  }
  return code;
}

async function createAvailableBindCode() {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const bindCode = createBindCode();
    const existing = await prisma.notifyChannel.findUnique({
      where: { bindCode },
      select: { id: true },
    });
    if (!existing) return bindCode;
  }
  throw new Error("BIND_CODE_ALLOCATION_FAILED");
}

export function normalizeBindCode(value: string) {
  return value.trim().toUpperCase().replace(/\s+/g, "");
}

/**
 * Create a channel, or return the one that already has this key.
 *
 * Callers are expected to call this on every send path rather than
 * provisioning up front -- TATO creates `staff:<id>` the first time
 * that person is assigned anything. Idempotent because the alternative
 * is every caller writing the same find-then-create race.
 */
export async function ensureChannel(input: {
  appId: string;
  key: string;
  name: string;
}) {
  const existing = await prisma.notifyChannel.findUnique({
    where: { appId_key: { appId: input.appId, key: input.key } },
  });
  if (existing) {
    // The name is the caller's to change -- a staff member gets
    // married, a crew is renamed -- and it is only ever display.
    if (existing.name !== input.name) {
      return prisma.notifyChannel.update({
        where: { id: existing.id },
        data: { name: input.name },
      });
    }
    return existing;
  }

  return prisma.notifyChannel.create({
    data: {
      appId: input.appId,
      key: input.key,
      name: input.name,
      bindCode: await createAvailableBindCode(),
    },
  });
}

/**
 * Bind a WeChat user to a channel by its code.
 *
 * `miniProgramId` is not decoration: the code is unique across every
 * app, but an openid only means anything under the mini program that
 * issued it. Binding a code belonging to an app on a different mini
 * program would store a string that can never be delivered to, so it
 * is refused here rather than discovered months later as silence.
 */
export async function bindSubscriber(input: {
  miniProgramId: string;
  openId: string;
  bindCode: string;
  label?: string | null;
}) {
  const channel = await prisma.notifyChannel.findUnique({
    where: { bindCode: normalizeBindCode(input.bindCode) },
    include: { app: true },
  });

  if (!channel || !channel.isActive || !channel.app.isActive) {
    return { ok: false as const, reason: "CHANNEL_NOT_FOUND" };
  }
  if (channel.app.miniProgramId !== input.miniProgramId) {
    return { ok: false as const, reason: "CHANNEL_WRONG_MINI_PROGRAM" };
  }

  const subscription = await prisma.notifySubscription.upsert({
    where: { channelId_openId: { channelId: channel.id, openId: input.openId } },
    create: {
      channelId: channel.id,
      openId: input.openId,
      label: input.label?.slice(0, 80) ?? null,
    },
    update: {
      // Re-binding clears a mute: the person just asked to be added
      // again, which is the clearest statement of intent available.
      mutedUntil: null,
      ...(input.label ? { label: input.label.slice(0, 80) } : {}),
    },
  });

  return { ok: true as const, channel, subscription };
}

export async function unbindSubscriber(input: { channelId: string; openId: string }) {
  await prisma.notifySubscription
    .delete({ where: { channelId_openId: { channelId: input.channelId, openId: input.openId } } })
    .catch(() => null);
}

export async function listSubscriberChannels(input: { miniProgramId: string; openId: string }) {
  const subscriptions = await prisma.notifySubscription.findMany({
    where: {
      openId: input.openId,
      channel: { isActive: true, app: { isActive: true, miniProgramId: input.miniProgramId } },
    },
    include: { channel: { include: { app: true } } },
    orderBy: { createdAt: "asc" },
  });

  return subscriptions.map((subscription) => ({
    subscriptionId: subscription.id,
    channelId: subscription.channel.id,
    channelKey: subscription.channel.key,
    channelName: subscription.channel.name,
    appKey: subscription.channel.app.key,
    appName: subscription.channel.app.name,
    mutedUntil: subscription.mutedUntil ? subscription.mutedUntil.toISOString() : null,
  }));
}
