import "server-only";

import { utcToZonedDate } from "@/lib/booking-time";
import { kimiExtractJson } from "@/lib/kimi";
import { foldLatinLookalikes } from "@/lib/utils";

/**
 * A WeChat or SMS message about a rental, turned into the fields of the
 * offline-order form -- a suggestion, never a save. The operator sees what
 * was read, fills the form with it, checks it, and saves it themselves.
 *
 * The car is matched the way the rest of TATO matches cars from text: a
 * plate in the message settles it; a model alone settles it only when
 * exactly one car in the fleet is that model. Two candidates are shown,
 * not guessed between.
 */

export type ParsedOrderNote = {
  renterName: string | null;
  renterPhone: string | null;
  vehicleText: string | null;
  pickupDate: string | null;
  pickupTime: string | null;
  returnDate: string | null;
  returnTime: string | null;
  totalPrice: number | null;
  depositAmount: number | null;
  pickupLocation: string | null;
  returnLocation: string | null;
  paymentMethod: string | null;
  notes: string | null;
};

const JSON_SHAPE =
  '{"renterName":string|null,"renterPhone":string|null,"vehicleText":string|null,"pickupDate":"YYYY-MM-DD"|null,"pickupTime":"HH:MM"|null,"returnDate":"YYYY-MM-DD"|null,"returnTime":"HH:MM"|null,"totalPrice":number|null,"depositAmount":number|null,"pickupLocation":string|null,"returnLocation":string|null,"paymentMethod":string|null,"notes":string|null}';

function systemPrompt(today: string) {
  return [
    "你从租车公司和客人的微信或短信里抽取一笔线下租车订单的字段。文字可能是中文、英文或混排。规则：",
    "- renterName 只填客人的名字，不要把整段话塞进去。renterPhone 只填电话号码。",
    "- vehicleText 填消息里提到的车：车牌（如 A091ES）优先，没有车牌就填品牌车型年份（如 Tesla Model Y 2024）。",
    `- 今天是 ${today}（温哥华）。日期输出 YYYY-MM-DD；只写了月日的，取今天以后最近的那一天；'明天''下周五'按今天推算。`,
    "- 时间输出 24 小时制 HH:MM；'下午3点' → 15:00；没写时间填 null。",
    "- totalPrice 是这笔租车的总价（客人一共付多少），depositAmount 是押金。金额是纯数字，不要 $、逗号或文字。只写了日租价和天数的，totalPrice = 日租价 × 天数。",
    "- pickupLocation / returnLocation 是取车、还车地点；paymentMethod 如 e-Transfer、现金、微信、支付宝。",
    "- notes 放其余对订单有用的信息（如 '要儿童座椅'），一句话以内。",
    "- 找不到的字段填 null，不要臆造。",
    "",
    "只输出一个 JSON 对象，不要 markdown 代码块、不要任何解释。字段：",
    JSON_SHAPE,
  ].join("\n");
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/[^0-9.\-]/g, "");
  if (!cleaned || cleaned === "-" || cleaned === ".") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function toText(value: unknown, max = 200): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text ? text.slice(0, max) : null;
}

function toDay(value: unknown) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.trim()) ? value.trim() : null;
}

function toTime(value: unknown) {
  if (typeof value !== "string") return null;
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) return null;
  return `${match[1].padStart(2, "0")}:${match[2]}`;
}

/** Whatever the model returned, cut down to the shape and types expected. */
export function normalizeParsedNote(raw: Record<string, unknown>): ParsedOrderNote {
  return {
    renterName: toText(raw.renterName, 120),
    renterPhone: toText(raw.renterPhone, 40),
    vehicleText: toText(raw.vehicleText, 120),
    pickupDate: toDay(raw.pickupDate),
    pickupTime: toTime(raw.pickupTime),
    returnDate: toDay(raw.returnDate),
    returnTime: toTime(raw.returnTime),
    totalPrice: toNumber(raw.totalPrice),
    depositAmount: toNumber(raw.depositAmount),
    pickupLocation: toText(raw.pickupLocation),
    returnLocation: toText(raw.returnLocation),
    paymentMethod: toText(raw.paymentMethod, 60),
    notes: toText(raw.notes, 300),
  };
}

type FleetVehicle = { id: string; plateNumber: string; brand: string; model: string; year: number; nickname: string };

const fold = (value: string) => foldLatinLookalikes(value).toLowerCase().replace(/[\s\-·]/g, "");

/**
 * The car a message names: by plate anywhere in the message or in what
 * the model read; else by model (and year, when given) -- settled only if
 * exactly one car fits. Returns the candidates either way.
 */
export function matchNoteVehicle(text: string, vehicleText: string | null, fleet: FleetVehicle[]) {
  const haystack = fold(`${text} ${vehicleText ?? ""}`);
  const byPlate = fleet.filter((vehicle) => vehicle.plateNumber && haystack.includes(fold(vehicle.plateNumber)));
  if (byPlate.length === 1) return { vehicleId: byPlate[0].id, candidates: byPlate.map((vehicle) => vehicle.id) };
  if (byPlate.length > 1) return { vehicleId: null, candidates: byPlate.map((vehicle) => vehicle.id) };

  if (!vehicleText) return { vehicleId: null, candidates: [] };
  const wanted = fold(vehicleText);
  const year = /\b(19|20)\d{2}\b/.exec(vehicleText)?.[0];
  const byModel = fleet.filter((vehicle) => {
    const model = fold(vehicle.model);
    if (!model || !wanted.includes(model)) return false;
    return !year || String(vehicle.year) === year;
  });
  return { vehicleId: byModel.length === 1 ? byModel[0].id : null, candidates: byModel.map((vehicle) => vehicle.id) };
}

export async function parseOrderNote(text: string, fleet: FleetVehicle[], now = new Date()) {
  const result = await kimiExtractJson<Record<string, unknown>>({
    system: systemPrompt(utcToZonedDate(now)),
    user: text.slice(0, 4000),
    maxTokens: 800,
    timeoutMs: 30_000,
  });
  if (!result.ok) return { ok: false as const, reason: result.reason };
  const fields = normalizeParsedNote(result.data ?? {});
  return { ok: true as const, fields, ...matchNoteVehicle(text, fields.vehicleText, fleet) };
}
