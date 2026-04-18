import { NextResponse } from "next/server";
import { z } from "zod";

import {
  getDirectBookingQuote,
  hasVehicleBookingConflict,
  isDateOnlyRangeValid,
} from "@/lib/direct-booking";
import { prisma } from "@/lib/prisma";
import { getAppUrl, getStripeClient, getStripeSecretKey } from "@/lib/stripe";

const checkoutSchema = z.object({
  vehicleId: z.string().min(1),
  pickupDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  returnDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  renterName: z.string().trim().min(2),
  renterEmail: z.string().trim().email(),
  renterPhone: z.string().trim().max(50).optional().or(z.literal("")),
  includeInsurance: z.boolean().optional().default(true),
});

export async function POST(request: Request) {
  try {
    if (!getStripeSecretKey()) {
      return NextResponse.json({ error: "Stripe is not configured." }, { status: 400 });
    }

    const parsed = checkoutSchema.parse(await request.json());
    if (!isDateOnlyRangeValid(parsed.pickupDate, parsed.returnDate)) {
      return NextResponse.json({ error: "Choose a valid pickup and return date." }, { status: 400 });
    }

    const vehicle = await prisma.vehicle.findUnique({
      where: { id: parsed.vehicleId },
      include: {
        orders: {
          where: {
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

    const quote = getDirectBookingQuote({
      pickupDate: parsed.pickupDate,
      returnDate: parsed.returnDate,
      bookingDailyRate: vehicle.bookingDailyRate ?? 0,
      bookingInsuranceFee: vehicle.bookingInsuranceFee ?? 0,
      includeInsurance: parsed.includeInsurance,
    });

    if (quote.days < 1 || quote.totalAmount <= 0) {
      return NextResponse.json({ error: "Quote could not be calculated." }, { status: 400 });
    }

    const stripe = getStripeClient();
    const appUrl = getAppUrl(new URL(request.url).origin);
    const successUrl = `${appUrl}/reserve/${vehicle.id}?checkout=success`;
    const cancelUrl = `${appUrl}/reserve/${vehicle.id}?checkout=cancelled`;

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      success_url: successUrl,
      cancel_url: cancelUrl,
      customer_email: parsed.renterEmail,
      metadata: {
        vehicleId: vehicle.id,
        vehiclePlateNumber: vehicle.plateNumber,
        vehicleName: vehicle.nickname,
        pickupDate: parsed.pickupDate,
        returnDate: parsed.returnDate,
        renterName: parsed.renterName,
        renterEmail: parsed.renterEmail,
        renterPhone: parsed.renterPhone ?? "",
        includeInsurance: parsed.includeInsurance ? "true" : "false",
        bookedDays: String(quote.days),
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
      ],
    });

    if (!session.url) {
      return NextResponse.json({ error: "Stripe did not return a checkout URL." }, { status: 400 });
    }

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
