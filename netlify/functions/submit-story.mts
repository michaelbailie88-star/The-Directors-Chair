import type { Context, Config } from "@netlify/functions";
import { db } from "./lib/db.mts";

// POST /submit-story
// Body: {
//   writer: { fullName, email, country, ageConfirmed },
//   path: "preset" | "original",
//   selectedPreset: { title, genre } | null,   // required if path === "preset"
//   originalPremise: string | null,             // required if path === "original"
//   characters: [{ name, description }],
//   consentChecked: boolean
// }
//
// Matches the locked spec exactly:
// - Path A (preset): free, credit_line = "Characters by", no payment step here
//   (payment never applies to Path A).
// - Path B (original): credit_line = "Story & Characters by", status starts
//   pending_review but paid stays false until the Stripe webhook confirms
//   the $10 charge — the submission exists before payment so nothing is
//   lost if checkout is abandoned, but it is NOT counted as a live
//   submission for review until paid = true (enforced in admin-list).
export default async (req: Request, context: Context) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), { status: 400 });
  }

  const { writer, path, selectedPreset, originalPremise, characters, consentChecked } = body || {};

  // ---- Validation (mirrors the DB constraints so bad data never reaches SQL) ----
  if (!writer?.fullName?.trim() || !writer?.email?.trim()) {
    return new Response(JSON.stringify({ error: "Writer name and email are required." }), { status: 400 });
  }
  if (!writer?.ageConfirmed) {
    return new Response(JSON.stringify({ error: "Age confirmation is required." }), { status: 400 });
  }
  if (path !== "preset" && path !== "original") {
    return new Response(JSON.stringify({ error: "path must be 'preset' or 'original'." }), { status: 400 });
  }
  if (path === "preset" && (!selectedPreset?.title || !selectedPreset?.genre)) {
    return new Response(JSON.stringify({ error: "selectedPreset is required for Path A." }), { status: 400 });
  }
  if (path === "original" && (!originalPremise || originalPremise.trim().length < 10)) {
    return new Response(JSON.stringify({ error: "originalPremise must be at least 10 characters for Path B." }), { status: 400 });
  }
  if (!Array.isArray(characters) || characters.length === 0 ||
      !characters.every((c: any) => c?.name?.trim() && c?.description?.trim())) {
    return new Response(JSON.stringify({ error: "Every character needs a name and description." }), { status: 400 });
  }
  if (!consentChecked) {
    return new Response(JSON.stringify({ error: "Consent must be confirmed before submitting." }), { status: 400 });
  }

  const database = db();

  // Find-or-create the writer by email. Kept intentionally simple (no
  // password/session auth) — this just avoids duplicate writer rows for
  // repeat submitters using the same email.
  const existing = await database.sql`SELECT id FROM writers WHERE email = ${writer.email.trim().toLowerCase()} LIMIT 1`;
  let writerId: string;
  if (existing.length > 0) {
    writerId = existing[0].id;
    await database.sql`
      UPDATE writers SET full_name = ${writer.fullName.trim()}, country = ${writer.country || null}, age_confirmed = true
      WHERE id = ${writerId}
    `;
  } else {
    const [newWriter] = await database.sql`
      INSERT INTO writers (full_name, email, country, age_confirmed)
      VALUES (${writer.fullName.trim()}, ${writer.email.trim().toLowerCase()}, ${writer.country || null}, true)
      RETURNING id
    `;
    writerId = newWriter.id;
  }

  const creditLine = path === "original" ? "Story & Characters by" : "Characters by";

  const [submission] = await database.sql`
    INSERT INTO submissions (
      writer_id, path, preset_title, preset_genre, original_premise,
      characters, consent_checked, paid, credit_line
    ) VALUES (
      ${writerId},
      ${path},
      ${path === "preset" ? selectedPreset.title : null},
      ${path === "preset" ? selectedPreset.genre : null},
      ${path === "original" ? originalPremise.trim() : null},
      ${JSON.stringify(characters)},
      true,
      false,
      ${creditLine}
    )
    RETURNING id
  `;

  return new Response(JSON.stringify({
    submissionId: submission.id,
    requiresPayment: path === "original"
  }), {
    status: 201,
    headers: { "content-type": "application/json" }
  });
};

export const config: Config = {
  path: "/submit-story"
};
