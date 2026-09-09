import type { Context, Config } from "@netlify/functions";
import { db } from "./lib/db.mts";
import { requireAdmin } from "./lib/auth.mts";

// GET /admin-list-casting?status=applied|shortlisted|cast|passed|all
export default async (req: Request, context: Context) => {
  const authError = requireAdmin(req);
  if (authError) return authError;

  if (req.method !== "GET") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
  }

  const url = new URL(req.url);
  const status = url.searchParams.get("status") || "all";

  const database = db();
  const rows = await database.sql`
    SELECT id, country, city, age, gender, email, handles, status, created_at
    FROM casting_applicants
    WHERE (${status} = 'all' OR status = ${status})
    ORDER BY created_at DESC
  `;

  return new Response(JSON.stringify({ applicants: rows }), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
};

export const config: Config = {
  path: "/admin-list-casting"
};
