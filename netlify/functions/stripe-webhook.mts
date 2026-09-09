import type { Context, Config } from "@netlify/functions";
import Stripe from "stripe";
import { db } from "./lib/db.mts";

// POST /stripe-webhook  (configured as the endpoint URL in the Stripe dashboard)
//
// Verifies the Stripe-Signature header against STRIPE_WEBHOOK_SECRET before
// trusting anything in the body — an unverified webhook would let anyone
// POST a fake "payment succeeded" event and get a submission marked paid
// for free. This is the one function in the whole app where that check is
// non-negotiable.
export default async (req: Request, context: Context) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const secretKey = Netlify.env.get("STRIPE_SECRET_KEY");
  const webhookSecret = Netlify.env.get("STRIPE_WEBHOOK_SECRET");
  if (!secretKey || !webhookSecret) {
    return new Response("Stripe is not configured yet.", { status: 500 });
  }

  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return new Response("Missing Stripe-Signature header.", { status: 400 });
  }

  const rawBody = await req.text();
  const stripe = new Stripe(secretKey);

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (err: any) {
    return new Response(`Webhook signature verification failed: ${err.message}`, { status: 400 });
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const submissionId = session.metadata?.submission_id;

    if (submissionId) {
      const database = db();
      await database.sql`
        UPDATE submissions
        SET paid = true,
            amount_paid_cents = ${session.amount_total ?? 1000},
            stripe_checkout_session_id = ${session.id},
            stripe_payment_intent_id = ${typeof session.payment_intent === "string" ? session.payment_intent : null},
            updated_at = now()
        WHERE id = ${submissionId} AND path = 'original'
      `;
    }
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
};

export const config: Config = {
  path: "/stripe-webhook"
};
