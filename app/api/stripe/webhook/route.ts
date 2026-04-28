import { NextResponse } from "next/server";

import {
  markWorkspaceBillingInvoiceFailed,
  markWorkspaceBillingInvoicePaid,
  syncWorkspaceBillingFromStripeSubscription,
  syncWorkspaceBillingFromSubscriptionId,
} from "@/lib/billing";
import { persistDirectBookingFromCheckoutSession } from "@/lib/direct-booking-server";
import { getStripeClient, getStripeWebhookSecret } from "@/lib/stripe";
import { syncWorkspaceConnectFromAccount } from "@/lib/stripe-connect";

export async function POST(request: Request) {
  const webhookSecret = getStripeWebhookSecret();
  if (!webhookSecret) {
    return NextResponse.json({ error: "Stripe webhook secret is not configured." }, { status: 500 });
  }

  const stripe = getStripeClient();
  const signature = request.headers.get("stripe-signature");

  if (!signature) {
    return NextResponse.json({ error: "Missing Stripe signature." }, { status: 400 });
  }

  try {
    const payload = await request.text();
    const event = await stripe.webhooks.constructEventAsync(payload, signature, webhookSecret);

    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        if (session.mode === "subscription" && session.subscription) {
          const subscriptionId =
            typeof session.subscription === "string"
              ? session.subscription
              : session.subscription.id;
          await syncWorkspaceBillingFromSubscriptionId(subscriptionId);
        } else if (session.mode === "payment") {
          await persistDirectBookingFromCheckoutSession(session);
        }
        break;
      }
      case "checkout.session.async_payment_succeeded": {
        const session = event.data.object;
        if (session.mode === "payment") {
          await persistDirectBookingFromCheckoutSession(session);
        }
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        await syncWorkspaceBillingFromStripeSubscription(event.data.object);
        break;
      }
      case "invoice.paid": {
        const invoice = event.data.object;
        const customerId =
          typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id;
        await markWorkspaceBillingInvoicePaid(customerId);
        break;
      }
      case "invoice.payment_failed": {
        const invoice = event.data.object;
        const customerId =
          typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id;
        await markWorkspaceBillingInvoiceFailed(customerId);
        break;
      }
      case "account.updated": {
        // Stripe Connect: a host finished (or progressed through) Express
        // onboarding. Mirror the latest enable flags into our DB so the
        // admin /payouts page and the public booking gate stay in sync
        // without the host clicking "refresh status".
        await syncWorkspaceConnectFromAccount(event.data.object);
        break;
      }
      default:
        break;
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Webhook processing failed",
      },
      { status: 400 },
    );
  }
}
