import type { Context, Config } from "@netlify/functions";
import { db } from "./lib/db.mts";

// GET /get-submission?id=<uuid>
//
// Public by design, scoped narrowly: knowing the submission's UUID is the
// same trust level as an order-confirmation link elsewhere. Powers two
// things: (1) the confirmation screen after a Stripe redirect wipes all
// in-memory page state, and (2) status.html — the page every confirmation
// email links to, so a writer can check their submission is real and see
// its current state without an account. Never returns the writer's email
// or any other submission.
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
    SELECT path, preset_title, preset_genre, original_premise, characters,
           credit_line, paid, status, feedback_text,
           second_look_start, second_look_expires, created_at
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
