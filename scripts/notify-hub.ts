/**
 * Provisioning for the notification hub.
 *
 * Apps, keys and channels are rows, and until an admin screen exists
 * this is how they are created. It is a CLI rather than a seed script
 * because minting a key prints a secret that is never recoverable --
 * that has to be a deliberate act by a person at a terminal, not
 * something a deploy does again every time it runs.
 *
 *   npx tsx scripts/notify-hub.ts status
 *   npx tsx scripts/notify-hub.ts mini-program:add --app-id wx123 --name "Ops"
 *   npx tsx scripts/notify-hub.ts mini-program:set --app-id wx123 --state formal
 *   npx tsx scripts/notify-hub.ts template:set --mini-program wx123 --key task \
 *       --template-id TMPL_X --fields '{"title":"thing1","due":"time2"}'
 *   npx tsx scripts/notify-hub.ts app:add --key tato --name TATO --mini-program wx123
 *   npx tsx scripts/notify-hub.ts app:labels --app hosthub --labels '{"room":"房间"}'
 *   npx tsx scripts/notify-hub.ts key:mint --app tato --name "railway prod"
 *   npx tsx scripts/notify-hub.ts channel:add --app tato --key staff:abc --name "Zhang"
 */

import { prisma } from "../lib/prisma";
import { createNotifyApiKey, revokeNotifyApiKey } from "../lib/notify-hub/auth";
import { ensureChannel } from "../lib/notify-hub/channels";
import { assertValidFieldLabels } from "../lib/notify-hub/labels";

function parseArgs(argv: string[]) {
  const args: Record<string, string> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    args[key] = next && !next.startsWith("--") ? next : "true";
    if (next && !next.startsWith("--")) index += 1;
  }
  return args;
}

function required(args: Record<string, string>, name: string) {
  const value = args[name]?.trim();
  if (!value) throw new Error(`Missing --${name}`);
  return value;
}

async function resolveMiniProgram(appId: string) {
  const miniProgram = await prisma.notifyMiniProgram.findUnique({ where: { appId } });
  if (!miniProgram) throw new Error(`No mini program with appId ${appId}`);
  return miniProgram;
}

async function resolveApp(key: string) {
  const app = await prisma.notifyApp.findUnique({ where: { key } });
  if (!app) throw new Error(`No app with key ${key}`);
  return app;
}

async function status() {
  const miniPrograms = await prisma.notifyMiniProgram.findMany({
    include: { apps: true, templates: true },
    orderBy: { createdAt: "asc" },
  });

  if (miniPrograms.length === 0) {
    console.log("No mini programs configured yet.");
    return;
  }

  for (const miniProgram of miniPrograms) {
    const secretPresent = Boolean(process.env[miniProgram.secretEnvVar]?.trim());
    console.log(`\n${miniProgram.name}  ${miniProgram.appId}  [${miniProgram.state}]`);
    console.log(
      `  secret: ${miniProgram.secretEnvVar} ${secretPresent ? "✓ present" : "✗ MISSING"}`,
    );
    console.log(
      `  templates: ${
        miniProgram.templates.map((template) => `${template.key}→${template.templateId}`).join(", ") ||
        "(none)"
      }`,
    );
    for (const app of miniProgram.apps) {
      const channels = await prisma.notifyChannel.count({ where: { appId: app.id } });
      const keys = await prisma.notifyApiKey.count({ where: { appId: app.id, revokedAt: null } });
      const subscribers = await prisma.notifySubscription.count({
        where: { channel: { appId: app.id } },
      });
      console.log(
        `  app ${app.key.padEnd(12)} ${app.isActive ? "active " : "paused "} ` +
          `${keys} key(s)  ${channels} channel(s)  ${subscribers} subscriber(s)`,
      );
    }
  }
  console.log("");
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);

  switch (command) {
    case "status":
      await status();
      return;

    case "mini-program:add": {
      const record = await prisma.notifyMiniProgram.create({
        data: {
          appId: required(args, "app-id"),
          name: required(args, "name"),
          ...(args["secret-env"] ? { secretEnvVar: args["secret-env"] } : {}),
          ...(args.state ? { state: args.state } : {}),
        },
      });
      console.log(`Mini program ${record.appId} added.`);
      console.log(`Set ${record.secretEnvVar} in the environment before sending.`);
      return;
    }

    case "mini-program:set": {
      // `miniprogram_state` used to be an environment variable. It is a
      // column now, which is why this exists: a mini program goes from
      // trial to formal on the day it is approved, and that day should
      // not need a redeploy.
      const miniProgram = await resolveMiniProgram(required(args, "app-id"));
      const state = required(args, "state");
      if (!["formal", "trial", "developer"].includes(state)) {
        throw new Error(`--state must be formal | trial | developer, got ${state}`);
      }
      await prisma.notifyMiniProgram.update({
        where: { id: miniProgram.id },
        data: { state },
      });
      console.log(`${miniProgram.appId} now sends with miniprogram_state=${state}.`);
      return;
    }

    case "template:set": {
      const miniProgram = await resolveMiniProgram(required(args, "mini-program"));
      const key = required(args, "key");
      const fields = required(args, "fields");
      // Parsed here so a typo fails at the terminal rather than at
      // send time, where it would look like a WeChat 47003.
      JSON.parse(fields);
      const record = await prisma.notifyTemplate.upsert({
        where: { miniProgramId_key: { miniProgramId: miniProgram.id, key } },
        create: {
          miniProgramId: miniProgram.id,
          key,
          templateId: required(args, "template-id"),
          fieldMap: fields,
        },
        update: { templateId: required(args, "template-id"), fieldMap: fields, isActive: true },
      });
      console.log(`Template ${record.key} → ${record.templateId}`);
      return;
    }

    case "app:add": {
      const miniProgram = await resolveMiniProgram(required(args, "mini-program"));
      const record = await prisma.notifyApp.create({
        data: {
          miniProgramId: miniProgram.id,
          key: required(args, "key"),
          name: required(args, "name"),
        },
      });
      console.log(`App ${record.key} added under ${miniProgram.appId}.`);
      return;
    }

    case "app:labels": {
      // What the mini program calls this app's fields. Merged over the
      // shared defaults, so only the app's own vocabulary goes here.
      const app = await resolveApp(required(args, "app"));
      const labels = required(args, "labels");
      assertValidFieldLabels(labels);
      await prisma.notifyApp.update({ where: { id: app.id }, data: { fieldLabels: labels } });
      console.log(`${app.key} field labels set: ${labels}`);
      console.log("Takes effect on the next inbox read -- no mini program release.");
      return;
    }

    case "app:move": {
      // The whole reason NotifyApp carries a mini program id: selling
      // HostHub should be this command, not a release.
      const app = await resolveApp(required(args, "app"));
      const miniProgram = await resolveMiniProgram(required(args, "mini-program"));
      await prisma.notifyApp.update({
        where: { id: app.id },
        data: { miniProgramId: miniProgram.id },
      });
      console.log(`App ${app.key} now sends through ${miniProgram.appId}.`);
      console.log("Subscribers must re-bind: openids do not carry across mini programs.");
      return;
    }

    case "key:mint": {
      const app = await resolveApp(required(args, "app"));
      const { token, record } = await createNotifyApiKey({
        appId: app.id,
        name: required(args, "name"),
      });
      console.log(`\nKey for ${app.key} (${record.name}):\n\n  ${token}\n`);
      console.log("Shown once. Store it in the calling system's environment now.\n");
      return;
    }

    case "key:revoke": {
      await revokeNotifyApiKey(required(args, "id"));
      console.log("Revoked.");
      return;
    }

    case "channel:add": {
      const app = await resolveApp(required(args, "app"));
      const channel = await ensureChannel({
        appId: app.id,
        key: required(args, "key"),
        name: required(args, "name"),
      });
      console.log(`Channel ${channel.key} — bind code ${channel.bindCode}`);
      return;
    }

    case "tato:sync": {
      // Backfill: every active staff member gets a channel, and anyone
      // already bound to WeChat through the old mini program gets a
      // subscription on it. Safe to re-run -- both halves are upserts.
      const app = await resolveApp(args.app?.trim() || "tato");
      const staff = await prisma.staffMember.findMany({
        where: { isActive: true },
        orderBy: { createdAt: "asc" },
      });

      let channels = 0;
      let subscriptions = 0;
      for (const member of staff) {
        const channel = await ensureChannel({
          appId: app.id,
          key: `staff:${member.id}`,
          name: member.name,
        });
        channels += 1;
        if (!member.wechatOpenId) continue;
        await prisma.notifySubscription.upsert({
          where: { channelId_openId: { channelId: channel.id, openId: member.wechatOpenId } },
          create: { channelId: channel.id, openId: member.wechatOpenId, label: member.name },
          update: {},
        });
        subscriptions += 1;
      }

      console.log(`${channels} channel(s), ${subscriptions} subscriber(s) synced into ${app.key}.`);
      console.log("Quota is not backfilled: an authorisation nobody made cannot be invented.");
      return;
    }

    case "channel:list": {
      const app = await resolveApp(required(args, "app"));
      const channels = await prisma.notifyChannel.findMany({
        where: { appId: app.id },
        include: { _count: { select: { subscriptions: true } } },
        orderBy: { createdAt: "asc" },
      });
      for (const channel of channels) {
        console.log(
          `${channel.bindCode}  ${channel.key.padEnd(24)} ${channel.name.padEnd(20)} ` +
            `${channel._count.subscriptions} subscriber(s)`,
        );
      }
      if (channels.length === 0) console.log("(no channels)");
      return;
    }

    default:
      console.log("Commands: status, mini-program:add, mini-program:set, template:set,");
      console.log("          app:add, app:labels, app:move, key:mint, key:revoke,");
      console.log("          channel:add, channel:list, tato:sync");
      process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
