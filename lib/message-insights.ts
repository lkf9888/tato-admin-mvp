import "server-only";

import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";

import { isKimiConfigured, kimiExtractJson } from "@/lib/kimi";
import { loadKnowledge } from "@/lib/message-knowledge-server";
import { prisma } from "@/lib/prisma";
import { getUploadRoot } from "@/lib/uploads";

/**
 * What guests ask about, measured from the message history.
 *
 * Step 0 of using the history for AI replies: before building anything,
 * find out which questions come up and how many of them the AI message
 * library can already answer. A random sample is classified rather than
 * every message -- 3,000 put each share within about two points, for a
 * fraction of the model time -- and the trivial ones ("thanks", "ok")
 * are counted over the whole history without a model.
 *
 * A one-off analysis, so its state is a JSON file on the volume rather
 * than a table: nothing else reads it, and it can be deleted.
 */

export const INTENTS = {
  pickup_location: "取车地点 / 怎么找到车",
  pickup_process: "取车流程 / 钥匙 / 开锁",
  pickup_time_change: "提前或推迟取车",
  return_process: "还车流程 / 还车地点",
  return_time_change: "提前或延后还车",
  extend_trip: "续租 / 延长行程",
  running_late: "客人迟到 / 航班延误",
  parking: "停车 / 停车费 / 机场停车楼",
  fuel_charging: "加油 / 充电 / 电量",
  car_features: "车辆功能和操作（座椅、蓝牙、CarPlay、儿童座椅等）",
  car_problem: "车辆故障 / 警示灯 / 事故 / 损坏",
  cleanliness: "清洁 / 异味 / 车内物品",
  lost_item: "遗失物品",
  tolls_tickets: "过路费 / 罚单 / 违章",
  delivery: "送车 / 接送服务",
  booking_change: "修改、取消、退款预订",
  pricing_payment: "价格 / 押金 / 付款 / 额外费用",
  documents_drivers: "驾照 / 证件 / 年龄 / 额外司机",
  mileage: "里程限制",
  rules: "宠物 / 吸烟 / 出境等规则",
  availability: "车是否可订 / 询问空档",
  thanks_ack: "致谢 / 确认收到",
  review_feedback: "评价 / 反馈 / 投诉",
  other: "其他",
} as const;

export type Intent = keyof typeof INTENTS;

const SAMPLE_SIZE = 3_000;
const BATCH = 30;
const CONCURRENCY = 4;
const RUN_BUDGET_MS = 200_000;
const MESSAGE_CHARS = 400;

type Classified = { id: string; intent: Intent; ask: string; stage: Stage };
type Stage = "before_pickup" | "during" | "after_return" | "no_trip";
type Coverage = { intent: Intent; coverage: "full" | "partial" | "none"; coveredBy: string[]; missing: string };

type State = {
  startedAt: string;
  totalGuestMessages: number;
  trivialCount: number;
  emptyCount: number;
  sampleIds: string[];
  classified: Classified[];
  failedBatches: number;
  coverage: Coverage[] | null;
  coverageAt: string | null;
};

function statePath(workspaceId: string) {
  return path.join(path.dirname(getUploadRoot()), "insights", `guest-intents-${workspaceId}.json`);
}

async function loadState(workspaceId: string): Promise<State | null> {
  try {
    return JSON.parse(await readFile(statePath(workspaceId), "utf8")) as State;
  } catch {
    return null;
  }
}

async function saveState(workspaceId: string, state: State) {
  const file = statePath(workspaceId);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(state));
}

/** "Thanks!", "ok 👍", "Perfect, see you then" -- nothing to answer. */
const TRIVIAL = /^(?:thanks?(?: you)?(?: so much| very much)?|thank u|thx|ty|ok(?:ay)?|k|great|perfect|awesome|sounds good|got it|noted|cool|nice|amazing|will do|sure|yes|no|yep|yeah|👍|🙏|谢谢|好的|收到)[\s!.,:)😊🙂🙏👍❤️]*(?:(?:see you(?: then| soon| tomorrow)?|have a (?:good|great|nice) (?:day|night|one|trip)|appreciate it|thank(?:s| you)(?: so much)?)[\s!.,:)😊🙂🙏👍❤️]*)*$/iu;

export function isTrivialMessage(text: string) {
  const normalized = text.trim().replace(/\s+/g, " ");
  return normalized.length < 3 || (normalized.length <= 60 && TRIVIAL.test(normalized));
}

/** A small, repeatable shuffle, so the sample is the same on every call. */
function seededShuffle<T>(items: T[], seed: number) {
  const out = [...items];
  let x = seed;
  for (let i = out.length - 1; i > 0; i -= 1) {
    x = (x * 1103515245 + 12345) % 2147483648;
    const j = x % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function stageOf(receivedAt: Date, trip: { pickupDatetime: Date; returnDatetime: Date } | null): Stage {
  if (!trip) return "no_trip";
  if (receivedAt < trip.pickupDatetime) return "before_pickup";
  if (receivedAt <= trip.returnDatetime) return "during";
  return "after_return";
}

async function startState(workspaceId: string): Promise<State> {
  const rows = await prisma.inboundEmail.findMany({
    where: { workspaceId, kind: "GUEST_MESSAGE" },
    select: { id: true, guestText: true },
  });
  let trivialCount = 0;
  let emptyCount = 0;
  const candidates: string[] = [];
  for (const row of rows) {
    const text = row.guestText?.trim() ?? "";
    if (!text) emptyCount += 1;
    else if (isTrivialMessage(text)) trivialCount += 1;
    else candidates.push(row.id);
  }
  const state: State = {
    startedAt: new Date().toISOString(),
    totalGuestMessages: rows.length,
    trivialCount,
    emptyCount,
    sampleIds: seededShuffle(candidates, 20261019).slice(0, SAMPLE_SIZE),
    classified: [],
    failedBatches: 0,
    coverage: null,
    coverageAt: null,
  };
  await saveState(workspaceId, state);
  return state;
}

const CLASSIFY_SYSTEM = `You label messages that rental-car guests sent to their host on Turo.

For each message return its single best intent from this list, and "ask": what the guest wants, in Chinese, at most 20 characters, with no names, phone numbers or addresses.

Intents:
${Object.entries(INTENTS)
  .map(([key, label]) => `- ${key}: ${label}`)
  .join("\n")}

Return ONLY JSON: {"items":[{"i":<number>,"intent":"<key>","ask":"<Chinese>"}]} with one item per message, in order.`;

async function classifyBatch(batch: { i: number; text: string }[]) {
  const result = await kimiExtractJson<{ items?: { i?: number; intent?: string; ask?: string }[] }>({
    system: CLASSIFY_SYSTEM,
    user: batch.map((item) => `[${item.i}] ${item.text}`).join("\n\n"),
    maxTokens: 3000,
    timeoutMs: 90_000,
  });
  if (!result.ok) return null;
  return result.data.items ?? [];
}

/**
 * Classify the next part of the sample, within one request's time.
 * Call again until `remaining` is 0.
 */
export async function runIntentClassification(workspaceId: string) {
  if (!isKimiConfigured()) throw new Error("AI_NOT_CONFIGURED");
  const startedAt = Date.now();
  const state = (await loadState(workspaceId)) ?? (await startState(workspaceId));
  const done = new Set(state.classified.map((item) => item.id));
  const pending = state.sampleIds.filter((id) => !done.has(id));

  while (pending.length > 0 && Date.now() - startedAt < RUN_BUDGET_MS) {
    const chunk = pending.splice(0, BATCH * CONCURRENCY);
    const rows = await prisma.inboundEmail.findMany({
      where: { workspaceId, id: { in: chunk } },
      select: {
        id: true,
        guestText: true,
        receivedAt: true,
        order: { select: { pickupDatetime: true, returnDatetime: true } },
      },
    });
    const batches: (typeof rows)[] = [];
    for (let i = 0; i < rows.length; i += BATCH) batches.push(rows.slice(i, i + BATCH));

    const results = await Promise.all(
      batches.map(async (batch) => {
        const items = await classifyBatch(
          batch.map((row, i) => ({ i, text: (row.guestText ?? "").replace(/\s+/g, " ").slice(0, MESSAGE_CHARS) })),
        );
        if (!items) {
          state.failedBatches += 1;
          return [];
        }
        return items.flatMap((item): Classified[] => {
          const row = typeof item.i === "number" ? batch[item.i] : undefined;
          if (!row) return [];
          const intent = (item.intent && item.intent in INTENTS ? item.intent : "other") as Intent;
          return [
            {
              id: row.id,
              intent,
              ask: (item.ask ?? "").slice(0, 40),
              stage: stageOf(row.receivedAt, row.order),
            },
          ];
        });
      }),
    );
    state.classified.push(...results.flat());
    await saveState(workspaceId, state);
  }

  const classifiedIds = new Set(state.classified.map((item) => item.id));
  return {
    classified: state.classified.length,
    remaining: state.sampleIds.filter((id) => !classifiedIds.has(id)).length,
    failedBatches: state.failedBatches,
  };
}

const COVERAGE_SYSTEM = `You check whether a rental-car host's AI message library can answer a kind of guest question.

You get one question category with example asks from real guests, and the library: replies, facts and internal rules the AI may use. Judge whether the library holds what is needed to answer these questions accurately without guessing.

Return ONLY JSON: {"coverage":"full"|"partial"|"none","coveredBy":["<entry label>",...],"missing":"<in Chinese: the facts or policies the host would need to add, at most 80 characters; empty if full>"}`;

/** Judge, for each common intent, whether the library can answer it. */
export async function runCoverageCheck(workspaceId: string) {
  if (!isKimiConfigured()) throw new Error("AI_NOT_CONFIGURED");
  const state = await loadState(workspaceId);
  if (!state || state.classified.length === 0) throw new Error("CLASSIFY_FIRST");

  const library = (await loadKnowledge(workspaceId)).filter((entry) => entry.aiEnabled);
  const libraryText = library
    .map(
      (entry) =>
        `- [${entry.kind}] ${entry.label}${entry.locations ? ` (where: ${entry.locations.join("/")})` : ""}${
          entry.vehicleIds ? ` (only ${entry.vehicleIds.length} cars)` : ""
        }: ${entry.content.replace(/\s+/g, " ").slice(0, 300)}`,
    )
    .join("\n");

  const byIntent = groupByIntent(state.classified);
  const common = [...byIntent.entries()]
    .filter(([intent, items]) => intent !== "thanks_ack" && items.length / state.classified.length >= 0.01)
    .sort((a, b) => b[1].length - a[1].length);

  const coverage: Coverage[] = [];
  for (let i = 0; i < common.length; i += CONCURRENCY) {
    const part = await Promise.all(
      common.slice(i, i + CONCURRENCY).map(async ([intent, items]): Promise<Coverage> => {
        const examples = [...new Set(items.map((item) => item.ask).filter(Boolean))].slice(0, 12);
        const result = await kimiExtractJson<{ coverage?: string; coveredBy?: string[]; missing?: string }>({
          system: COVERAGE_SYSTEM,
          user: `Category: ${INTENTS[intent]}\nExample asks:\n${examples.map((ask) => `- ${ask}`).join("\n")}\n\nLibrary:\n${libraryText || "(empty)"}`,
          maxTokens: 600,
          timeoutMs: 90_000,
        });
        const data = result.ok ? result.data : {};
        const level = data.coverage === "full" || data.coverage === "partial" ? data.coverage : "none";
        return {
          intent,
          coverage: level,
          coveredBy: Array.isArray(data.coveredBy) ? data.coveredBy.slice(0, 5) : [],
          missing: result.ok ? (data.missing ?? "").slice(0, 160) : "（判断失败）",
        };
      }),
    );
    coverage.push(...part);
  }

  state.coverage = coverage;
  state.coverageAt = new Date().toISOString();
  await saveState(workspaceId, state);
  return { intents: coverage.length, libraryEntries: library.length };
}

function groupByIntent(items: Classified[]) {
  const map = new Map<Intent, Classified[]>();
  for (const item of items) {
    const list = map.get(item.intent) ?? [];
    list.push(item);
    map.set(item.intent, list);
  }
  return map;
}

/** The numbers, ready to read. */
export async function intentReport(workspaceId: string) {
  const state = await loadState(workspaceId);
  if (!state) return null;
  const sampled = state.classified.length;
  const substantive = state.totalGuestMessages - state.trivialCount - state.emptyCount;
  const coverageByIntent = new Map((state.coverage ?? []).map((item) => [item.intent, item]));

  const intents = [...groupByIntent(state.classified).entries()]
    .map(([intent, items]) => {
      const stages: Record<Stage, number> = { before_pickup: 0, during: 0, after_return: 0, no_trip: 0 };
      for (const item of items) stages[item.stage] += 1;
      const asks = new Map<string, number>();
      for (const item of items) if (item.ask) asks.set(item.ask, (asks.get(item.ask) ?? 0) + 1);
      return {
        intent,
        label: INTENTS[intent],
        count: items.length,
        share: sampled ? items.length / sampled : 0,
        estimatedTotal: sampled ? Math.round((items.length / sampled) * substantive) : 0,
        stages,
        topAsks: [...asks.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 8)
          .map(([ask, count]) => ({ ask, count })),
        coverage: coverageByIntent.get(intent) ?? null,
      };
    })
    .sort((a, b) => b.count - a.count);

  return {
    startedAt: state.startedAt,
    totalGuestMessages: state.totalGuestMessages,
    trivialCount: state.trivialCount,
    emptyCount: state.emptyCount,
    substantive,
    sampleSize: state.sampleIds.length,
    classified: sampled,
    failedBatches: state.failedBatches,
    coverageAt: state.coverageAt,
    intents,
  };
}
