import type { Context, Config } from "@netlify/functions";
import { db } from "./lib/db.mts";
import { requireAdmin } from "./lib/auth.mts";

// POST /admin-delete-submission
// Body: { submissionId }
//
// Permanent, irreversible. Deliberately scoped to closed submissions only —
// enforced here in the WHERE clause, not just disabled in the admin UI —
// so this can never be the tool that accidentally destroys a submission
// that's still pending, in Second Look, or (worst case) already selected
// and in production. If it isn't closed, this is a no-op that reports
// exactly why nothing happened, rather than silently failing.
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

  const { submissionId } = body || {};
  if (!submissionId) {
    return new Response(JSON.stringify({ error: "submissionId is required." }), { status: 400 });
  }

  const database = db();
  const [existing] = await database.sql`SELECT id, status FROM submissions WHERE id = ${submissionId} LIMIT 1`;
  if (!existing) {
    return new Response(JSON.stringify({ error: "Submission not found." }), { status: 404 });
  }
  if (existing.status !== "closed") {
    return new Response(JSON.stringify({
      error: `Only closed submissions can be deleted. This one is currently "${existing.status}".`
    }), { status: 409 });
  }

  await database.sql`DELETE FROM submissions WHERE id = ${submissionId}`;

  return new Response(JSON.stringify({ deleted: true, submissionId }), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
};

export const config: Config = {
  path: "/admin-delete-submission"
};
