import type { Context, Config } from "@netlify/functions";
import Stripe from "stripe";
import { db } from "./lib/db.mts";

// POST /create-checkout-session
// Body: { submissionId: string }
// Returns: { url: string } — redirect the browser here to collect the $10.00.
//
// The submission must already exist (created by /submit-story) and be an
// unpaid Path B submission — this endpoint never creates a submission on
// its own, so there is no way to buy "selection" without a real story on
// file first.
export default async (req: Request, context: Context) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
  }

  const secretKey = Netlify.env.get("STRIPE_SECRET_KEY");
  if (!secretKey) {
    return new Response(JSON.stringify({ error: "Stripe is not configured yet." }), { status: 500 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), { status: 400 });
  }

  const { submissionId } = body || {};
  if (!submissionId) {
    return new Response(JSON.stringify({ error: "submissionId is required." }), { status: 400 });
  }

  const database = db();
  const [submission] = await database.sql`
    SELECT id, path, paid FROM submissions WHERE id = ${submissionId} LIMIT 1
  `;
  if (!submission) {
    return new Response(JSON.stringify({ error: "Submission not found." }), { status: 404 });
  }
  if (submission.path !== "original") {
    return new Response(JSON.stringify({ error: "Only original submissions require payment." }), { status: 400 });
  }
  if (submission.paid) {
    return new Response(JSON.stringify({ error: "This submission is already paid." }), { status: 400 });
  }

  const stripe = new Stripe(secretKey);
  const origin = new URL(req.url).origin;

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    line_items: [{
      price_data: {
        currency: "usd",
        unit_amount: 1000,
        product_data: { name: "The Director's Chair — Original Story Submission Fee" }
      },
      quantity: 1
    }],
    metadata: { submission_id: submissionId },
    success_url: `${origin}/call-sheet.html?submission=${submissionId}&paid=1`,
    cancel_url: `${origin}/call-sheet.html?submission=${submissionId}&paid=0`
  });

  return new Response(JSON.stringify({ url: session.url }), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
};

export const config: Config = {
  path: "/create-checkout-session"
};
