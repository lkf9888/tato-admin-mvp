import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { z } from "zod";

import {
  getDirectBookingQuote,
  hasVehicleBookingConflict,
  isDateOnlyRangeValid,
} from "@/lib/direct-booking";
import { prisma } from "@/lib/prisma";
import { getAppUrl, getStripeClient, getStripeSecretKey } from "@/lib/stripe";
import {
  PLATFORM_APPLICATION_FEE_PERCENT,
  getWorkspaceConnectSnapshot,
} from "@/lib/stripe-connect";
import {
  makeDirectBookingDocumentPath,
  resolveUploadPath,
  sanitizeFilename,
} from "@/lib/uploads";

export const runtime = "nodejs";

const MAX_LICENSE_FILE_BYTES = 10 * 1024 * 1024;
const LICENSE_DOCUMENT_KINDS = {
  front: "driver_license_front",
  back: "driver_license_back",
} as const;

const checkoutSchema = z.object({
  vehicleId: z.string().min(1),
  pickupDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  returnDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  renterName: z.string().trim().min(2),
  renterEmail: z.string().trim().email(),
  renterPhone: z.string().trim().max(50).optional().or(z.literal("")),
  includeInsurance: z.boolean().optional().default(true),
  agreementAccepted: z.boolean().refine(Boolean, "Rental agreement must be accepted."),
});

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

  const parsed = checkoutSchema.parse({
    vehicleId: readFormString(formData, "vehicleId"),
    pickupDate: readFormString(formData, "pickupDate"),
    returnDate: readFormString(formData, "returnDate"),
    renterName: readFormString(formData, "renterName"),
    renterEmail: readFormString(formData, "renterEmail"),
    renterPhone: readFormString(formData, "renterPhone"),
    includeInsurance: readFormBoolean(formData, "includeInsurance"),
    agreementAccepted: readFormBoolean(formData, "agreementAccepted"),
  });

  return { parsed, licenseFront, licenseBack };
}

export async function POST(request: Request) {
  try {
    if (!getStripeSecretKey()) {
      return NextResponse.json({ error: "Stripe is not configured." }, { status: 400 });
    }

    const { parsed, licenseFront, licenseBack } = await readCheckoutRequest(request);
    if (!isDateOnlyRangeValid(parsed.pickupDate, parsed.returnDate)) {
      return NextResponse.json({ error: "Choose a valid pickup and return date." }, { status: 400 });
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

    if (!vehicle || !vehicle.directBookingEnabled || (vehicle.bookingDailyRate ?? 0) <= 0) {
      return NextResponse.json({ error: "This vehicle is not bookable right now." }, { status: 400 });
    }

    if (hasVehicleBookingConflict(vehicle.orders, parsed.pickupDate, parsed.returnDate)) {
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

    const quote = getDirectBookingQuote({
      pickupDate: parsed.pickupDate,
      returnDate: parsed.returnDate,
      bookingDailyRate: vehicle.bookingDailyRate ?? 0,
      bookingInsuranceFee: vehicle.bookingInsuranceFee ?? 0,
      bookingDepositAmount: vehicle.bookingDepositAmount ?? 0,
      bookingTaxRate: vehicle.bookingTaxRate ?? 0,
      includeInsurance: parsed.includeInsurance,
    });

    if (quote.days < 1 || quote.totalAmount <= 0) {
      return NextResponse.json({ error: "Quote could not be calculated." }, { status: 400 });
    }

    const stripe = getStripeClient();
    const appUrl = getAppUrl(new URL(request.url).origin);
    const successUrl = `${appUrl}/reserve/${vehicle.id}?checkout=success`;
    const cancelUrl = `${appUrl}/reserve/${vehicle.id}?checkout=cancelled`;

    // Platform fee = 5% of rental + insurance (NOT the refundable deposit).
    // Deposit is a hold the host needs to release, not earned revenue.
    const feeBaseCents = Math.round((quote.baseAmount + quote.insuranceAmount) * 100);
    const applicationFeeAmount = Math.round(
      feeBaseCents * (PLATFORM_APPLICATION_FEE_PERCENT / 100),
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

    await prisma.directBookingDocument.createMany({
      data: licenseDocuments.map((document) => ({
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

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      success_url: successUrl,
      cancel_url: cancelUrl,
      customer_email: parsed.renterEmail,
      // Destination charge with on_behalf_of:
      //   - Funds settle on the host's Connect account.
      //   - Renter's card statement shows the host's business name (because
      //     `on_behalf_of` makes the connected account the merchant of record).
      //   - Platform takes a 5% application fee out of the rental + insurance
      //     portion before the rest is transferred.
      payment_intent_data: {
        on_behalf_of: connectSnapshot.accountId!,
        transfer_data: { destination: connectSnapshot.accountId! },
        application_fee_amount: applicationFeeAmount > 0 ? applicationFeeAmount : undefined,
      },
      metadata: {
        vehicleId: vehicle.id,
        workspaceId: vehicle.workspaceId,
        vehiclePlateNumber: vehicle.plateNumber,
        vehicleName: vehicle.nickname,
        pickupDate: parsed.pickupDate,
        returnDate: parsed.returnDate,
        renterName: parsed.renterName,
        renterEmail: parsed.renterEmail,
        renterPhone: parsed.renterPhone ?? "",
        includeInsurance: parsed.includeInsurance ? "true" : "false",
        bookedDays: String(quote.days),
        depositAmount: String(quote.depositAmount),
        taxName: vehicle.bookingTaxName?.trim() || "",
        taxRate: String(vehicle.bookingTaxRate ?? 0),
        taxAmount: String(quote.taxAmount),
        licenseDraftId,
        agreementAccepted: "true",
        connectAccountId: connectSnapshot.accountId!,
        applicationFeeAmount: String(applicationFeeAmount),
      },
      line_items: [
        {
          quantity: quote.days,
          price_data: {
            currency: "cad",
            unit_amount: Math.round((vehicle.bookingDailyRate ?? 0) * 100),
            product_data: {
              name: `${vehicle.nickname} booking`,
              description: `${vehicle.plateNumber} · ${parsed.pickupDate} to ${parsed.returnDate}`,
            },
          },
        },
        ...(parsed.includeInsurance && (vehicle.bookingInsuranceFee ?? 0) > 0
          ? [
              {
                quantity: quote.days,
                price_data: {
                  currency: "cad",
                  unit_amount: Math.round((vehicle.bookingInsuranceFee ?? 0) * 100),
                  product_data: {
                    name: `${vehicle.nickname} insurance`,
                    description: "Daily protection fee",
                  },
                },
              },
            ]
          : []),
        ...(quote.taxAmount > 0
          ? [
              {
                quantity: 1,
                price_data: {
                  currency: "cad",
                  unit_amount: Math.round(quote.taxAmount * 100),
                  product_data: {
                    name: `${vehicle.bookingTaxName?.trim() || "Tax"} (${(vehicle.bookingTaxRate ?? 0).toFixed(3)}%)`,
                    description: "Tax on rental and insurance",
                  },
                },
              },
            ]
          : []),
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
      ],
    });

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
