import "server-only";

import { OrderAttachmentKind } from "@prisma/client";

import { listBookingLocations } from "@/lib/booking-locations";
import { renterDailyPrice, resolveBookingPolicy } from "@/lib/booking-policy";
import { getWorkspaceBookingPolicy } from "@/lib/booking-policy-server";
import { kimiChat } from "@/lib/kimi";
import { prisma } from "@/lib/prisma";
import { buildVehicleSlug, getSiteUrl } from "@/lib/rental-site";
import { verifyAdRewrite, type AdDraft, type AdFacts } from "@/lib/site-ad-copy";
import { isImageAttachment } from "@/lib/uploads";
import { parseVehicleFeatures } from "@/lib/vehicle-features";
import { isVehicleBookable, resolveVehicleDailyRate } from "@/lib/vehicle-pricing";

/**
 * One car's ad facts, read from the same places the booking page reads
 * them, so an ad cannot quote a price the site does not.
 */
export async function loadAdFacts(workspaceId: string, vehicleId: string): Promise<AdFacts | null> {
  const [vehicle, fleetPolicy, site, locations] = await Promise.all([
    prisma.vehicle.findFirst({
      where: { id: vehicleId, workspaceId },
      include: {
        attachments: {
          where: { isArchived: false, kind: OrderAttachmentKind.photo },
          select: { contentType: true, filename: true },
        },
      },
    }),
    getWorkspaceBookingPolicy(workspaceId),
    prisma.rentalSite.findUnique({ where: { workspaceId } }),
    listBookingLocations(workspaceId),
  ]);
  if (!vehicle) return null;
  const terms = resolveBookingPolicy(fleetPolicy, vehicle);
  const rate = resolveVehicleDailyRate(vehicle, fleetPolicy);
  const location = locations.find((each) => each.isDefault) ?? locations[0] ?? null;
  // Only a car the site actually shows has a page to send people to.
  const listed = Boolean(site?.isPublished && vehicle.directBookingEnabled && !vehicle.isArchived);
  return {
    brand: vehicle.brand,
    model: vehicle.model,
    year: vehicle.year,
    features: parseVehicleFeatures(vehicle.bookingFeatures),
    intro: vehicle.bookingIntro?.trim() || null,
    dailyFrom: isVehicleBookable(rate) ? renterDailyPrice(rate.dailyRate ?? 0, terms.insuranceFee) : null,
    weeklyDiscountPercent: terms.weeklyDiscountPercent,
    minimumRentalDays: terms.minimumRentalDays,
    dailyKmAllowance: terms.dailyKmAllowance,
    extraKmRate: terms.extraKmRate,
    depositAmount: terms.depositAmount,
    location: location?.label ?? null,
    carUrl: listed && site ? getSiteUrl(site, `/cars/${buildVehicleSlug(vehicle)}`) : null,
    photoCount: vehicle.attachments.filter((each) => isImageAttachment(each.contentType, each.filename)).length,
    brandName: site?.brandName ?? "",
    phone: site?.contactPhone?.trim() || null,
    wechat: site?.wechatId?.trim() || null,
  };
}

const SYSTEM: Record<"zh" | "en", string> = {
  zh: `你在为温哥华的一家租车公司改写分类广告。
铁律：
1. 只能改写给你的草稿，不能新增任何事实：没写的配置、车况、位置、优惠，一个字都不许加。
2. 草稿里的每个数字都必须原样保留（价格、押金、公里数、折扣、年份、电话），不能新增任何数字。
3. 预订链接必须原样保留。
4. 不要用「豪华」「最便宜」「绝佳」这类没有事实依据的词。让句子通顺、像人写的即可。
5. 标题不超过 {limit} 个字。输出简体中文。
输出格式，严格如下，不要任何其他文字：
TITLE: <标题>
BODY:
<正文>`,
  en: `You are rewriting a classified ad for a car-rental business in Vancouver.
Hard rules:
1. Rewrite only the draft given to you. Invent nothing: no features, condition, location or deals the draft does not state.
2. Keep every number in the draft exactly as written (price, deposit, kilometres, discount, year, phone), and add no new numbers.
3. Keep the booking link exactly as written.
4. No unsupported superlatives ("luxury", "cheapest", "best"). Make it read naturally, as a person would write it.
5. The title must be at most {limit} characters. Write in English.
Output exactly this, nothing else:
TITLE: <title>
BODY:
<body>`,
};

export type PolishedAd =
  | { ok: true; title: string; body: string }
  | { ok: false; reason: string };

/**
 * The draft rewritten to read like a person wrote it -- or, when the
 * rewrite changes a fact, the reason it was thrown away. The draft is
 * always correct; the rewrite has to prove it is too.
 */
export async function polishAdDraft(draft: AdDraft): Promise<PolishedAd> {
  const result = await kimiChat({
    messages: [
      { role: "system", content: SYSTEM[draft.locale].replace("{limit}", String(draft.titleLimit)) },
      { role: "user", content: `TITLE: ${draft.title}\nBODY:\n${draft.body}` },
    ],
    maxTokens: 1200,
    timeoutMs: 45_000,
  });
  if (!result.ok) return { ok: false, reason: result.reason };
  const match = result.content.match(/TITLE:\s*(.+?)\s*\n\s*BODY:\s*\n?([\s\S]+)/);
  if (!match) return { ok: false, reason: "unparseable" };
  const rewrite = { title: match[1].trim(), body: match[2].trim() };
  const problem = verifyAdRewrite(draft, rewrite);
  return problem ? { ok: false, reason: problem } : { ok: true, ...rewrite };
}
