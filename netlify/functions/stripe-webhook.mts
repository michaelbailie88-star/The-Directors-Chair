import type { Context, Config } from "@netlify/functions";
import Stripe from "stripe";
import { db } from "./lib/db.mts";
import { sendEmail, emailShell, ADMIN_EMAIL } from "./lib/email.mts";

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

      // AND paid = false matters for two reasons: it stops Stripe's webhook
      // retries (a real, expected occurrence) from re-processing an already-
      // confirmed payment, and — since it's paired with RETURNING — it's
      // exactly how we know whether this delivery is the FIRST confirmation,
      // which is the only time the receipt email should go out.
      const [updated] = await database.sql`
        UPDATE submissions
        SET paid = true,
            amount_paid_cents = ${session.amount_total ?? 1000},
            stripe_checkout_session_id = ${session.id},
            stripe_payment_intent_id = ${typeof session.payment_intent === "string" ? session.payment_intent : null},
            updated_at = now()
        WHERE id = ${submissionId} AND path = 'original' AND paid = false
        RETURNING id, original_premise, credit_line
      `;

      if (updated) {
        const [writer] = await database.sql`
          SELECT w.full_name, w.email
          FROM writers w
          JOIN submissions s ON s.writer_id = w.id
          WHERE s.id = ${submissionId}
          LIMIT 1
        `;

        if (writer) {
          const origin = new URL(req.url).origin;
          const statusUrl = `${origin}/status.html?id=${updated.id}`;
          const amount = ((session.amount_total ?? 1000) / 100).toFixed(2);

          await sendEmail({
            to: { email: writer.email, name: writer.full_name },
            subject: "Payment received — your story is submitted",
            htmlContent: emailShell(`
              <p style="color:#F2EDE3; font-size:16px; margin-bottom:16px;">Hi ${writer.full_name},</p>
              <p style="color:#F2EDE3; font-size:15px; line-height:1.6; margin-bottom:16px;">
                Payment of <strong>$${amount}</strong> is confirmed, and your original story is in the review queue.
              </p>
              <div style="background:#0A0908; border:1px solid #2a251c; border-radius:4px; padding:16px; margin-bottom:20px;">
                <p style="color:#E8A33D; font-size:12px; text-transform:uppercase; letter-spacing:0.05em; margin-bottom:6px;">Your Premise</p>
                <p style="color:#8A8378; font-size:14px; font-style:italic; line-height:1.5;">${updated.original_premise}</p>
              </div>
              <p style="color:#8A8378; font-size:14px; line-height:1.6; margin-bottom:20px;">
                Guaranteed read, guaranteed feedback either way. You'll be credited as <strong style="color:#E8A33D;">${updated.credit_line} ${writer.full_name}</strong> if selected.
              </p>
              <a href="${statusUrl}" style="display:inline-block; background:#E8A33D; color:#0A0908; padding:12px 22px; border-radius:4px; font-weight:600; font-size:14px;">Check your status</a>
            `)
          }).catch((err) => console.error("stripe-webhook: writer email failed", err));

          await sendEmail({
            to: { email: ADMIN_EMAIL },
            subject: `Paid Path B submission — $${amount}`,
            htmlContent: emailShell(`
              <p style="color:#F2EDE3; font-size:15px; margin-bottom:12px;">${writer.full_name} (${writer.email}) paid $${amount} for an original story submission.</p>
              <a href="${origin}/admin/index.html" style="color:#E8A33D; font-size:14px;">Open admin dashboard &rarr;</a>
            `)
          }).catch((err) => console.error("stripe-webhook: admin email failed", err));
        }
      }
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
