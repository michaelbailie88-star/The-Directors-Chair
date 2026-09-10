import type { Context, Config } from "@netlify/functions";
import { db } from "./lib/db.mts";
import { requireAdmin } from "./lib/auth.mts";
import { sendEmail, emailShell } from "./lib/email.mts";

// POST /admin-update-casting
// Body: { applicantId, status: "applied" | "shortlisted" | "cast" | "passed" }
export default async (req: Request, context: Context) => {
  const authError = requireAdmin(req);
  if (authError) return authError;

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), { status: 400 });
  }

  const { applicantId, status } = body || {};
  const validStatuses = ["applied", "shortlisted", "cast", "passed"];
  if (!applicantId || !validStatuses.includes(status)) {
    return new Response(JSON.stringify({ error: "applicantId and a valid status are required." }), { status: 400 });
  }

  const database = db();
  const [current] = await database.sql`SELECT status FROM casting_applicants WHERE id = ${applicantId} LIMIT 1`;
  if (!current) {
    return new Response(JSON.stringify({ error: "Applicant not found." }), { status: 404 });
  }

  const [updated] = await database.sql`
    UPDATE casting_applicants SET status = ${status} WHERE id = ${applicantId} RETURNING *
  `;

  // Same guard as admin-update-submission: compare against the PRE-update
  // status, so re-clicking "cast" on someone already cast (or flipping
  // status back and forth) never re-sends the notification.
  if (status === "cast" && current.status !== "cast") {
    await sendEmail({
      to: { email: updated.email },
      subject: "You've been cast — The Director's Chair",
      htmlContent: emailShell(`
        <p style="color:#F2EDE3; font-size:15px; line-height:1.6; margin-bottom:16px;">
          You've been cast. You'll be contacted directly with the character, script details, and filming instructions.
        </p>
        <p style="color:#8A8378; font-size:14px; line-height:1.6;">
          Reminder: this is unpaid — full credit only, per the terms you agreed to when applying. No filming happens together in person; you'll shoot your confessional alone, on your own phone.
        </p>
      `)
    }).catch((err) => console.error("admin-update-casting: cast email failed", err));
  }

  return new Response(JSON.stringify({ applicant: updated }), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
};

export const config: Config = {
  path: "/admin-update-casting"
};
