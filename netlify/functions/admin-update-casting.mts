import type { Context, Config } from "@netlify/functions";
import { db } from "./lib/db.mts";
import { requireAdmin } from "./lib/auth.mts";

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
  const [updated] = await database.sql`
    UPDATE casting_applicants SET status = ${status} WHERE id = ${applicantId} RETURNING *
  `;
  if (!updated) {
    return new Response(JSON.stringify({ error: "Applicant not found." }), { status: 404 });
  }

  return new Response(JSON.stringify({ applicant: updated }), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
};

export const config: Config = {
  path: "/admin-update-casting"
};
