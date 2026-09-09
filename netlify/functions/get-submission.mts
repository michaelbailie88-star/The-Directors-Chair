import type { Context, Config } from "@netlify/functions";
import { db } from "./lib/db.mts";

// GET /get-submission?id=<uuid>
//
// Public by design, scoped narrowly: knowing the submission's UUID is the
// same trust level as an order-confirmation link elsewhere — it exists so
// the confirmation screen renders correctly after a Stripe redirect wipes
// all in-memory page state (full navigation away and back). Returns only
// what the confirmation UI needs, never the writer's email or other
// submissions.
export default async (req: Request, context: Context) => {
  if (req.method !== "GET") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
  }

  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) {
    return new Response(JSON.stringify({ error: "id is required." }), { status: 400 });
  }

  const database = db();
  const [submission] = await database.sql`
    SELECT path, preset_title, original_premise, credit_line, paid
    FROM submissions
    WHERE id = ${id}
    LIMIT 1
  `;

  if (!submission) {
    return new Response(JSON.stringify({ error: "Not found." }), { status: 404 });
  }

  return new Response(JSON.stringify({ submission }), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
};

export const config: Config = {
  path: "/get-submission"
};
