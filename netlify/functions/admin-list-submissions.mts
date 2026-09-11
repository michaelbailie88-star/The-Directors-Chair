import type { Context, Config } from "@netlify/functions";
import { db } from "./lib/db.mts";
import { requireAdmin } from "./lib/auth.mts";

// GET /admin-list-submissions?status=pending_review|second_look|selected|closed|all
//                             &includeUnpaid=1
//
// Default view excludes unpaid Path B submissions (someone started
// checkout and never finished) — those never entered the real review
// queue per the locked spec. Pass includeUnpaid=1 to see them anyway,
// clearly labeled, since "see everything" should mean everything is
// reachable, just not mixed into the queue by default.
export default async (req: Request, context: Context) => {
  const authError = requireAdmin(req);
  if (authError) return authError;

  if (req.method !== "GET") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
  }

  const url = new URL(req.url);
  const status = url.searchParams.get("status") || "all";
  const includeUnpaid = url.searchParams.get("includeUnpaid") === "1";

  const database = db();

  const rows = await database.sql`
    SELECT
      s.id, s.path, s.status, s.preset_title, s.preset_genre, s.original_premise,
      s.characters, s.consent_checked, s.paid, s.amount_paid_cents,
      s.second_look_start, s.second_look_expires, s.feedback_text, s.credit_line,
      s.generated_packets, s.created_at, s.updated_at,
      w.full_name AS writer_name, w.email AS writer_email, w.country AS writer_country
    FROM submissions s
    JOIN writers w ON w.id = s.writer_id
    WHERE
      (${status} = 'all' OR s.status = ${status})
      AND (${includeUnpaid} OR NOT (s.path = 'original' AND s.paid = false))
    ORDER BY s.created_at DESC
  `;

  return new Response(JSON.stringify({ submissions: rows }), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
};

export const config: Config = {
  path: "/admin-list-submissions"
};
