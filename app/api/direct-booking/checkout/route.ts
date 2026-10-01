import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { z } from "zod";

import {
  getDirectBookingInstalmentPlan,
  getDirectBookingQuote,
  hasTimedBookingConflict,
} from "@/lib/direct-booking";
import { getBookingPolicyForVehicle } from "@/lib/booking-policy-server";
import { isVehicleBookable, resolveVehicleDailyRate } from "@/lib/vehicle-pricing";
import {
  buildSeasonalRateMap,
  getBookingWindowDayKeys,
  getRateSeasonality,
} from "@/lib/rental-estimate/rate-seasonality-server";
import { loadPriceOverridesForBooking } from "@/lib/vehicle-price-overrides";
import {
  describeBookingLocation,
  listBookingLocations,
  resolveBookingLocation,
} from "@/lib/booking-locations";
import {
  encodeAddOnsMetadata,
  MAX_ADD_ONS_PER_BOOKING,
  resolveAddOns,
} from "@/lib/booking-add-ons";
import { listBookingAddOns } from "@/lib/booking-add-ons-server";
import { prisma } from "@/lib/prisma";
import { getBookingReturnUrls } from "@/lib/rental-site";
import { DEFAULT_BOOKING_TIME, zonedDateTimeToUtc } from "@/lib/booking-time";
import type { CouponDiscount } from "@/lib/booking-coupons";
import {
  attachCouponToSession,
  checkCoupon,
  COUPON_HOLD_MINUTES,
  releaseCoupon,
  reserveCoupon,
} from "@/lib/booking-coupons-server";
import { getStripeCheckoutLocale, isSiteLocale } from "@/lib/site-locale";
import { clientIp } from "@/lib/contract-signing";
import { getStripeClient, getStripeSecretKey } from "@/lib/stripe";
import {
  computePlatformFeeCents,
  getWorkspaceConnectSnapshot,
} from "@/lib/stripe-connect";
import {
  makeDirectBookingDocumentPath,
  resolveUploadPath,
  sanitizeFilename,
} from "@/lib/uploads";

export const runtime = "nodejs";

type CheckoutLineItem = NonNullable<
  NonNullable<Parameters<Stripe["checkout"]["sessions"]["create"]>[0]>["line_items"]
>[number];

const MAX_LICENSE_FILE_BYTES = 10 * 1024 * 1024;
const LICENSE_DOCUMENT_KINDS = {
  front: "driver_license_front",
  back: "driver_license_back",
} as const;

const COUPON_ERRORS = {
  not_found: "That coupon code is not valid.",
  redeemed: "That coupon code has already been used.",
  expired: "That coupon code has expired.",
  voided: "That coupon code is no longer valid.",
  reserved: "That coupon code is being used in another checkout. Try again in a few minutes.",
} as const;

const checkoutSchema = z.object({
  vehicleId: z.string().min(1),
  pickupDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  returnDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  // A page from before times were asked for sends none; ten o'clock
  // is what that page's renter would have been told at the counter.
  pickupTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).default(DEFAULT_BOOKING_TIME),
  returnTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).default(DEFAULT_BOOKING_TIME),
  renterName: z.string().trim().min(2),
  renterEmail: z.string().trim().email(),
  renterPhone: z.string().trim().max(50).optional().or(z.literal("")),
  pickupLocationId: z.string().trim().max(60).optional(),
  returnLocationId: z.string().trim().max(60).optional(),
  agreementAccepted: z.boolean().refine(Boolean, "Rental agreement must be accepted."),
  // Asked only when the fleet charges a non-BC licence differently.
  hasLocalLicence: z.enum(["yes", "no"]).optional(),
  couponCode: z.string().trim().max(40).optional(),
  addOnIds: z.array(z.string().trim().min(1).max(60)).max(MAX_ADD_ONS_PER_BOOKING).default([]),
});

/** The renter's signature, drawn on the booking page. */
const RENTER_SIGNATURE_KIND = "renter_signature";
const SIGNATURE_DATA_URL = /^data:image\/png;base64,[A-Za-z0-9+/=]+$/;
/** A drawn signature is a few tens of KB; this is generous. */
const MAX_SIGNATURE_CHARS = 600_000;

type LicenseDocumentKind = (typeof LICENSE_DOCUMENT_KINDS)[keyof typeof LICENSE_DOCUMENT_KINDS];

type SavedLicenseDocument = {
  kind: LicenseDocumentKind;
  pathname: string;
  filename: string;
  contentType: string;
  size: number;
};

function readFormString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

function readFormBoolean(formData: FormData, key: string) {
  return readFormString(formData, key) === "true";
}

function getUploadedLicenseFile(formData: FormData, key: string) {
  const value = formData.get(key);
  if (!(value instanceof File) || value.size <= 0) return null;
  return value;
}

function validateLicenseFile(file: File, label: string) {
  const contentType = file.type.toLowerCase();
  const filename = file.name.toLowerCase();
  const allowed =
    contentType.startsWith("image/") ||
    contentType === "application/pdf" ||
    /\.(jpg|jpeg|png|webp|heic|heif|pdf)$/.test(filename);

  if (!allowed) {
    throw new Error(`${label} must be an image or PDF file.`);
  }

  if (file.size > MAX_LICENSE_FILE_BYTES) {
    throw new Error(`${label} must be 10MB or smaller.`);
  }
}

async function saveLicenseDocument(input: {
  draftId: string;
  kind: LicenseDocumentKind;
  file: File;
}): Promise<SavedLicenseDocument> {
  validateLicenseFile(input.file, input.kind);

  const filename = sanitizeFilename(input.file.name || `${input.kind}.jpg`);
  const pathname = makeDirectBookingDocumentPath(input.draftId, input.kind, filename);
  const absolutePath = resolveUploadPath(pathname);
  const bytes = Buffer.from(await input.file.arrayBuffer());

  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, bytes);

  return {
    kind: input.kind,
    pathname,
    filename,
    contentType: input.file.type || "application/octet-stream",
    size: bytes.length,
  };
}

async function readCheckoutRequest(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("multipart/form-data")) {
    throw new Error("Driver license front and back uploads are required.");
  }

  const formData = await request.formData();
  const licenseFront = getUploadedLicenseFile(formData, "licenseFront");
  const licenseBack = getUploadedLicenseFile(formData, "licenseBack");

  if (!licenseFront || !licenseBack) {
    throw new Error("Upload both the front and back of the driver's license.");
  }

  // The renter's signature from the booking page, as a PNG data URL.
  // It is the agreement's signature, so a page that sends none is
  // refused rather than booked unsigned.
  const signature = readFormString(formData, "signature");
  if (!SIGNATURE_DATA_URL.test(signature) || signature.length > MAX_SIGNATURE_CHARS) {
    throw new Error("Please sign the rental agreement before paying.");
  }

  const parsed = checkoutSchema.parse({
    vehicleId: readFormString(formData, "vehicleId"),
    pickupDate: readFormString(formData, "pickupDate"),
    returnDate: readFormString(formData, "returnDate"),
    pickupTime: readFormString(formData, "pickupTime") || undefined,
    returnTime: readFormString(formData, "returnTime") || undefined,
    renterName: readFormString(formData, "renterName"),
    renterEmail: readFormString(formData, "renterEmail"),
    renterPhone: readFormString(formData, "renterPhone"),
    pickupLocationId: readFormString(formData, "pickupLocationId") || undefined,
    returnLocationId: readFormString(formData, "returnLocationId") || undefined,
    agreementAccepted: readFormBoolean(formData, "agreementAccepted"),
    hasLocalLicence: readFormString(formData, "hasLocalLicence") || undefined,
    couponCode: readFormString(formData, "couponCode") || undefined,
    addOnIds: formData.getAll("addOnId").filter((value): value is string => typeof value === "string"),
  });

  // The language the renter was reading in, so Stripe's page and the
  // page they come back to both stay in it.
  const rawLocale = formData.get("locale");
  const siteLocale = isSiteLocale(rawLocale) ? rawLocale : "en";

  return { parsed, licenseFront, licenseBack, siteLocale, signature };
}

export async function POST(request: Request) {
  try {
    if (!getStripeSecretKey()) {
      return NextResponse.json({ error: "Stripe is not configured." }, { status: 400 });
    }

    const { parsed, licenseFront, licenseBack, siteLocale, signature } =
      await readCheckoutRequest(request);
    // When and from where the renter signed, for the agreement's audit
    // trail; the webhook applies the signature after payment.
    const signedAt = new Date();
    const signerIp = clientIp(request);
    const signerUserAgent = (request.headers.get("user-agent") ?? "").slice(0, 300);
    // The trip as two moments on the operator's clock. Same-day trips
    // are fine now that there are times; a return before the pickup is
    // not.
    const pickupAt = zonedDateTimeToUtc(parsed.pickupDate, parsed.pickupTime);
    const returnAt = zonedDateTimeToUtc(parsed.returnDate, parsed.returnTime);
    if (!pickupAt || !returnAt || returnAt <= pickupAt) {
      return NextResponse.json({ error: "Choose a valid pickup and return time." }, { status: 400 });
    }
    if (pickupAt.getTime() < Date.now() - 15 * 60_000) {
      return NextResponse.json({ error: "The pickup time has already passed." }, { status: 400 });
    }

    const vehicle = await prisma.vehicle.findUnique({
      where: { id: parsed.vehicleId },
      include: {
        orders: {
          where: {
            isArchived: false,
            status: {
              not: "cancelled",
            },
          },
        },
      },
    });

    if (!vehicle || vehicle.isArchived || !vehicle.directBookingEnabled) {
      return NextResponse.json({ error: "This vehicle is not bookable right now." }, { status: 400 });
    }

    if (hasTimedBookingConflict(vehicle.orders, pickupAt, returnAt)) {
      return NextResponse.json(
        { error: "Those dates overlap an existing booking." },
        { status: 400 },
      );
    }

    // Stripe Connect gate: payments for direct bookings must route to the
    // host's Connect account, not the platform owner. If the host has not
    // finished Stripe Express onboarding yet, the renter is not allowed to
    // pay through this vehicle.
    if (!vehicle.workspaceId) {
      return NextResponse.json(
        { error: "This vehicle is not assigned to a workspace yet, so we cannot route payment to the host." },
        { status: 400 },
      );
    }

    const connectSnapshot = await getWorkspaceConnectSnapshot(vehicle.workspaceId);
    if (!connectSnapshot.accountId || !connectSnapshot.chargesEnabled) {
      return NextResponse.json(
        {
          error:
            "The host hasn't finished setting up payouts yet. Please ask the host to connect their Stripe account from the Payouts page before booking.",
        },
        { status: 400 },
      );
    }

    // Resolved server-side and never taken from the request: the
    // browser prices with the same numbers, but a discount the client
    // chose for itself would be a discount anyone could choose.
    const policy = await getBookingPolicyForVehicle(vehicle);
    // Insurance by licence: the non-BC rate for a renter who said they
    // hold another licence, when the fleet charges one. A page that
    // should have asked and did not is refused rather than guessed.
    const asksLicenceRegion = policy.insuranceFeeNonLocal !== policy.insuranceFee;
    if (asksLicenceRegion && !parsed.hasLocalLicence) {
      return NextResponse.json(
        { error: "Tell us whether you hold a BC driver's licence." },
        { status: 400 },
      );
    }
    const insuranceFee =
      asksLicenceRegion && parsed.hasLocalLicence === "no"
        ? policy.insuranceFeeNonLocal
        : policy.insuranceFee;
    // A coupon is checked here and held just before the Stripe session
    // is made (below), so a code that fails never reaches payment.
    let coupon: (CouponDiscount & { id: string }) | null = null;
    if (parsed.couponCode) {
      const check = await checkCoupon(vehicle.workspaceId, parsed.couponCode);
      if (!check.ok) {
        return NextResponse.json({ error: COUPON_ERRORS[check.reason] }, { status: 400 });
      }
      coupon = check.coupon;
    }
    const rate = resolveVehicleDailyRate(vehicle, policy);
    if (!isVehicleBookable(rate)) {
      return NextResponse.json({ error: "This vehicle is not priced yet." }, { status: 400 });
    }
    const dailyRate = rate.dailyRate ?? 0;
    const dailyRateOverrides = await loadPriceOverridesForBooking(vehicle.id);

    // Only a car the model prices follows the season. A typed rate is
    // a flat statement, and bending it by month would overrule the
    // person who typed it.
    const seasonalRates =
      rate.source === "suggested"
        ? buildSeasonalRateMap(
            dailyRate,
            getBookingWindowDayKeys(),
            await getRateSeasonality(vehicle.workspaceId),
          )
        : {};

    // Priced from the list, never from the request: a fee sent by the
    // browser would be a fee the browser could choose.
    const locations = await listBookingLocations(vehicle.workspaceId);
    const pickupLocation = resolveBookingLocation(locations, parsed.pickupLocationId);
    const returnLocation = resolveBookingLocation(locations, parsed.returnLocationId);
    if (locations.length > 0 && (!pickupLocation || !returnLocation)) {
      return NextResponse.json(
        { error: "Choose where the car is collected from and returned to." },
        { status: 400 },
      );
    }
    const pickupLocationFee = pickupLocation?.fee ?? 0;
    const returnLocationFee = returnLocation?.fee ?? 0;

    // Extras, likewise priced from the operator's list. One that has
    // since been withdrawn is refused, not silently left off.
    const addOnOptions = await listBookingAddOns(vehicle.workspaceId);
    const { picked: addOns, unknown: unknownAddOn } = resolveAddOns(addOnOptions, parsed.addOnIds);
    if (unknownAddOn) {
      return NextResponse.json(
        { error: "One of the extras you chose is no longer offered. Refresh the page and choose again." },
        { status: 400 },
      );
    }

    const quote = getDirectBookingQuote({
      pickupDate: parsed.pickupDate,
      returnDate: parsed.returnDate,
      bookingDailyRate: dailyRate,
      dailyRateOverrides,
      seasonalRates,
      pickupLocationFee,
      returnLocationFee,
      bookingInsuranceFee: insuranceFee,
      bookingDepositAmount: policy.depositAmount,
      bookingTaxRate: policy.taxRate,
      taxLines: policy.taxLines,
      weeklyDiscountPercent: policy.weeklyDiscountPercent,
      pickupTime: parsed.pickupTime,
      returnTime: parsed.returnTime,
      graceMinutes: policy.returnGraceMinutes,
      coupon,
      addOns,
    });

    if (quote.days < 1 || quote.totalAmount <= 0) {
      return NextResponse.json({ error: "Quote could not be calculated." }, { status: 400 });
    }

    if (quote.days < policy.minimumRentalDays) {
      return NextResponse.json(
        {
          error: `This vehicle is rented for a minimum of ${policy.minimumRentalDays} days.`,
        },
        { status: 400 },
      );
    }

    // A booking longer than one period is charged for its first period
    // only; the rest become instalments the operator collects. What
    // Stripe sees is therefore `plan.dueNow`, while the order records
    // the full contract value.
    const plan = getDirectBookingInstalmentPlan({
      pickupDate: parsed.pickupDate,
      returnDate: parsed.returnDate,
      bookingDailyRate: dailyRate,
      dailyRateOverrides,
      seasonalRates,
      pickupLocationFee,
      returnLocationFee,
      bookingInsuranceFee: insuranceFee,
      bookingDepositAmount: policy.depositAmount,
      bookingTaxRate: policy.taxRate,
      taxLines: policy.taxLines,
      weeklyDiscountPercent: policy.weeklyDiscountPercent,
      pickupTime: parsed.pickupTime,
      returnTime: parsed.returnTime,
      graceMinutes: policy.returnGraceMinutes,
      coupon,
      addOns,
    });
    const firstPeriod = plan.instalments[0] ?? null;
    const chargedDays = firstPeriod?.days ?? quote.days;
    const chargedRent = firstPeriod ? firstPeriod.rentAmount : quote.baseAmount;
    const chargedInsurance = firstPeriod ? firstPeriod.insuranceAmount : quote.insuranceAmount;
    const chargedTaxes = firstPeriod ? firstPeriod.taxes : quote.taxes;
    // A one-off, so it is charged in full with the first period.
    const chargedLocationFee = firstPeriod
      ? firstPeriod.locationFeeAmount
      : quote.locationFeeAmount;
    // Each extra as charged now: per-day ones for the first period's
    // days, one-off ones in full.
    const chargedAddOns = quote.addOnLines.map((line) => ({
      ...line,
      quantity: line.unit === "day" ? chargedDays : 1,
    }));
    const chargedAddOnAmount = chargedAddOns.reduce(
      (sum, line) => sum + line.price * line.quantity,
      0,
    );

    const stripe = getStripeClient();
    const { successUrl, cancelUrl } = await getBookingReturnUrls(
      vehicle,
      new URL(request.url).origin,
      siteLocale,
    );

    const licenseDraftId = randomUUID();
    const licenseDocuments = await Promise.all([
      saveLicenseDocument({
        draftId: licenseDraftId,
        kind: LICENSE_DOCUMENT_KINDS.front,
        file: licenseFront,
      }),
      saveLicenseDocument({
        draftId: licenseDraftId,
        kind: LICENSE_DOCUMENT_KINDS.back,
        file: licenseBack,
      }),
    ]);

    const signatureBytes = Buffer.from(signature.slice(signature.indexOf(",") + 1), "base64");
    const signaturePath = makeDirectBookingDocumentPath(
      licenseDraftId,
      RENTER_SIGNATURE_KIND,
      "signature.png",
    );
    await mkdir(path.dirname(resolveUploadPath(signaturePath)), { recursive: true });
    await writeFile(resolveUploadPath(signaturePath), signatureBytes);

    await prisma.directBookingDocument.createMany({
      data: [
        ...licenseDocuments,
        {
          kind: RENTER_SIGNATURE_KIND,
          pathname: signaturePath,
          filename: "signature.png",
          contentType: "image/png",
          size: signatureBytes.length,
        },
      ].map((document) => ({
        workspaceId: vehicle.workspaceId,
        vehicleId: vehicle.id,
        draftId: licenseDraftId,
        kind: document.kind,
        pathname: document.pathname,
        filename: document.filename,
        contentType: document.contentType,
        size: document.size,
      })),
    });

    const lineItems: CheckoutLineItem[] = [
      {
        // One line, not `quantity x unit_amount`: days can be priced
        // individually, so there is no single unit price that
        // multiplies out to the right number. The day count moves
        // into the description instead.
        quantity: 1,
        price_data: {
          currency: "cad",
          // Rent and insurance as one line: the operator presents
          // insurance as part of the price, not an extra. They are
          // still taxed (rent only) and commissioned as before.
          unit_amount: Math.round((chargedRent + chargedInsurance) * 100),
          product_data: {
            name: `${vehicle.nickname} booking`,
            description:
              `${vehicle.plateNumber} · ${parsed.pickupDate} ${parsed.pickupTime} to ${parsed.returnDate} ${parsed.returnTime} · ${chargedDays} day(s)` +
              (coupon && quote.couponAmount > 0
                ? ` · coupon ${coupon.code} −$${quote.couponAmount.toFixed(2)}`
                : ""),
          },
        },
      },
      // One line per tax, as each is filed: GST and PST are separate
      // on the receipt the renter keeps. Rent only, so says the note.
      ...chargedTaxes
        .filter((tax) => tax.amount > 0)
        .map((tax) => ({
          quantity: 1,
          price_data: {
            currency: "cad",
            unit_amount: Math.round(tax.amount * 100),
            product_data: {
              name: `${tax.name} (${Number(tax.rate.toFixed(3))}%)`,
              description: "Tax on the rental",
            },
          },
        })),
      ...(chargedLocationFee > 0
        ? [
            {
              quantity: 1,
              price_data: {
                currency: "cad",
                unit_amount: Math.round(chargedLocationFee * 100),
                product_data: {
                  name: `${vehicle.nickname} collection & return`,
                  description: [
                    describeBookingLocation(pickupLocation),
                    describeBookingLocation(returnLocation),
                  ]
                    .filter(Boolean)
                    .join(" → ") || "Collection and return",
                },
              },
            },
          ]
        : []),
      ...chargedAddOns
        .filter((line) => line.price > 0)
        .map((line) => ({
          quantity: line.quantity,
          price_data: {
            currency: "cad",
            unit_amount: Math.round(line.price * 100),
            product_data: {
              name: line.name,
              description: line.unit === "day" ? "Extra, per day" : "Extra, per booking",
            },
          },
        })),
      ...(quote.depositAmount > 0
        ? [
            {
              quantity: 1,
              price_data: {
                currency: "cad",
                unit_amount: Math.round(quote.depositAmount * 100),
                product_data: {
                  name: `${vehicle.nickname} deposit`,
                  description: "Refundable security deposit",
                },
              },
            },
          ]
        : []),
    ];
    const chargeTotalCents = lineItems.reduce(
      (sum, item) => sum + (item.price_data?.unit_amount ?? 0) * (item.quantity ?? 1),
      0,
    );
    // TATO's cut: 5% of what the host earns plus the Stripe fee on the
    // whole charge, so the Stripe fee is the host's cost, not the
    // platform's. See `computePlatformFeeCents`.
    const platformFee = computePlatformFeeCents({
      commissionBaseCents: Math.round(
        (chargedRent + chargedInsurance + chargedLocationFee + chargedAddOnAmount) * 100,
      ),
      chargeTotalCents,
    });
    const applicationFeeAmount = platformFee.total;

    // Held for this checkout only; another renter's Apply now fails.
    const couponHoldKey = randomUUID();
    if (coupon && !(await reserveCoupon(coupon.id, couponHoldKey))) {
      return NextResponse.json({ error: COUPON_ERRORS.reserved }, { status: 400 });
    }

    const session = await stripe.checkout.sessions
      .create({
      mode: "payment",
      // With a code held, the payment page lasts as long as the hold
      // (Stripe's shortest), so it cannot outlive it.
      ...(coupon
        ? { expires_at: Math.floor(Date.now() / 1000) + COUPON_HOLD_MINUTES * 60 }
        : {}),
      locale: getStripeCheckoutLocale(siteLocale),
      success_url: successUrl,
      cancel_url: cancelUrl,
      customer_email: parsed.renterEmail,
      // A customer holding the card, so a late return or an early
      // pickup can be charged afterwards -- the rental agreement's
      // payment clause authorises it, and Checkout tells the renter
      // the card is kept for that.
      customer_creation: "always",
      // Destination charge with on_behalf_of:
      //   - Funds settle on the host's Connect account.
      //   - Renter's card statement shows the host's business name (because
      //     `on_behalf_of` makes the connected account the merchant of record).
      //   - Platform takes its application fee (5% commission plus the
      //     Stripe fee estimate) before the rest is transferred.
      payment_intent_data: {
        on_behalf_of: connectSnapshot.accountId!,
        transfer_data: { destination: connectSnapshot.accountId! },
        application_fee_amount: applicationFeeAmount > 0 ? applicationFeeAmount : undefined,
        setup_future_usage: "off_session",
        // Read back by refunds, which return the commission share only.
        metadata: {
          tato_platform_commission_cents: String(platformFee.commission),
          tato_stripe_fee_estimate_cents: String(platformFee.processing),
        },
      },
      metadata: {
        vehicleId: vehicle.id,
        workspaceId: vehicle.workspaceId,
        vehiclePlateNumber: vehicle.plateNumber,
        vehicleName: vehicle.nickname,
        pickupDate: parsed.pickupDate,
        returnDate: parsed.returnDate,
        pickupTime: parsed.pickupTime,
        returnTime: parsed.returnTime,
        renterName: parsed.renterName,
        renterEmail: parsed.renterEmail,
        renterPhone: parsed.renterPhone ?? "",
        // Insurance is part of the price whenever the car has a fee;
        // the webhook reads this to write the contract's insurance line.
        includeInsurance: insuranceFee > 0 ? "true" : "false",
        // The rate actually charged, which the contract prints and the
        // instalment schedule re-prices from.
        insuranceDailyRate: String(insuranceFee),
        hasLocalLicence: parsed.hasLocalLicence ?? "",
        couponCode: coupon?.code ?? "",
        couponKind: coupon?.kind ?? "",
        couponValue: coupon ? String(coupon.value) : "",
        couponAmount: String(quote.couponAmount),
        bookedDays: String(quote.days),
        isInstalmentPlan: plan.isInstalmentPlan ? "true" : "false",
        instalmentCount: String(plan.instalments.length),
        contractTotal: String(plan.totalAmount),
        dueNow: String(plan.dueNow),
        dueLater: String(plan.dueLater),
        depositAmount: String(quote.depositAmount),
        taxName: policy.taxName ?? "",
        taxRate: String(policy.taxRate),
        taxAmount: String(quote.taxAmount),
        // Name, rate and amount per tax, for the order and the contract.
        taxLines: JSON.stringify(
          quote.taxes.map((tax) => ({ name: tax.name, rate: tax.rate, amount: tax.amount })),
        ).slice(0, 500),
        pickupLocation: describeBookingLocation(pickupLocation) ?? "",
        returnLocation: describeBookingLocation(returnLocation) ?? "",
        locationFeeAmount: String(quote.locationFeeAmount),
        addOnAmount: String(quote.addOnAmount),
        // What each extra was, at what price, for the order record.
        ...encodeAddOnsMetadata(quote.addOnLines),
        licenseDraftId,
        agreementAccepted: "true",
        agreementSignedAt: signedAt.toISOString(),
        signerIp: signerIp ?? "",
        signerUserAgent,
        connectAccountId: connectSnapshot.accountId!,
        applicationFeeAmount: String(applicationFeeAmount),
      },
      line_items: lineItems,
      })
      .catch(async (error) => {
        if (coupon) await releaseCoupon(coupon.id, couponHoldKey);
        throw error;
      });
    if (coupon) await attachCouponToSession(coupon.id, couponHoldKey, session.id);

    if (!session.url) {
      return NextResponse.json({ error: "Stripe did not return a checkout URL." }, { status: 400 });
    }

    await prisma.directBookingDocument.updateMany({
      where: { draftId: licenseDraftId },
      data: { checkoutSessionId: session.id },
    });

    return NextResponse.json({ url: session.url });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Direct booking checkout failed.",
      },
      { status: 400 },
    );
  }
}
