import type { Context, Config } from "@netlify/functions";
import { db } from "./lib/db.mts";
import { requireAdmin } from "./lib/auth.mts";

// POST /admin-update-submission
// Body: { submissionId, action: "select" | "not_selected" | "close", feedback?: string }
//
// Implements the locked transition rules exactly:
// - "select"        -> status = 'selected' (from pending_review OR second_look)
// - "not_selected":
//     path = 'original' + currently pending_review -> 'second_look',
//       second_look_start = now(), second_look_expires = now() + 30 days
//     path = 'preset'   (any status)                -> 'closed' directly
//       (Path A has no fee, so no Second Look — matches the DB constraint)
// - "close"          -> force 'closed' from anywhere (manual override, e.g.
//                       ending a Second Look early)
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

  const { submissionId, action, feedback } = body || {};
  if (!submissionId || !["select", "not_selected", "close"].includes(action)) {
    return new Response(JSON.stringify({ error: "submissionId and a valid action are required." }), { status: 400 });
  }

  const database = db();
  const [current] = await database.sql`SELECT id, path, status FROM submissions WHERE id = ${submissionId} LIMIT 1`;
  if (!current) {
    return new Response(JSON.stringify({ error: "Submission not found." }), { status: 404 });
  }

  if (action === "select") {
    await database.sql`
      UPDATE submissions
      SET status = 'selected', feedback_text = COALESCE(${feedback ?? null}, feedback_text), updated_at = now()
      WHERE id = ${submissionId}
    `;
  } else if (action === "close") {
    await database.sql`
      UPDATE submissions
      SET status = 'closed', feedback_text = COALESCE(${feedback ?? null}, feedback_text), updated_at = now()
      WHERE id = ${submissionId}
    `;
  } else if (action === "not_selected") {
    if (current.path === "original" && current.status === "pending_review") {
      await database.sql`
        UPDATE submissions
        SET status = 'second_look',
            second_look_start = now(),
            second_look_expires = now() + interval '30 days',
            feedback_text = COALESCE(${feedback ?? null}, feedback_text),
            updated_at = now()
        WHERE id = ${submissionId}
      `;
    } else {
      // Path A submissions, or a Path B submission already past its first
      // review (e.g. reconsidered during Second Look and still passed on)
      // close directly — no second reconsideration window is granted.
      await database.sql`
        UPDATE submissions
        SET status = 'closed', feedback_text = COALESCE(${feedback ?? null}, feedback_text), updated_at = now()
        WHERE id = ${submissionId}
      `;
    }
  }

  const [updated] = await database.sql`SELECT * FROM submissions WHERE id = ${submissionId}`;
  return new Response(JSON.stringify({ submission: updated }), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
};

export const config: Config = {
  path: "/admin-update-submission"
};
