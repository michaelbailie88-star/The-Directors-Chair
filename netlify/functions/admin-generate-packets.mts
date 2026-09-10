import type { Context, Config } from "@netlify/functions";
import { db } from "./lib/db.mts";
import { requireAdmin } from "./lib/auth.mts";

// POST /admin-generate-packets
// Body: { submissionId }
//
// Generates a per-character confessional packet (voice direction, riff
// beats, sample lines) for a Selected submission, via a server-side call
// to the Claude API — never exposed to the browser, unlike the original
// prototype this replaces.
//
// Two parsing behaviors below exist because of things discovered testing
// this directly against the real API before writing this function:
//   1. Claude sometimes wraps JSON output in a ```json code fence despite
//      being told not to — stripped defensively rather than trusted away.
//   2. On more complex requests the model can engage extended thinking,
//      which adds a `thinking` content block BEFORE the `text` block —
//      so the text block is found by type, never assumed to be index 0.
export default async (req: Request, context: Context) => {
  const authError = requireAdmin(req);
  if (authError) return authError;

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
  }

  const apiKey = Netlify.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) {
    return new Response(JSON.stringify({ error: "Anthropic is not configured yet." }), { status: 500 });
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
  const [sub] = await database.sql`
    SELECT id, path, status, preset_title, preset_genre, original_premise, characters
    FROM submissions
    WHERE id = ${submissionId}
    LIMIT 1
  `;
  if (!sub) {
    return new Response(JSON.stringify({ error: "Submission not found." }), { status: 404 });
  }
  // Packets only make sense once a submission is actually greenlit — this
  // guards against generating (and paying for) content for something that
  // might still get closed out unselected.
  if (sub.status !== "selected") {
    return new Response(JSON.stringify({
      error: `Only Selected submissions can have packets generated. This one is "${sub.status}".`
    }), { status: 409 });
  }

  const premise = sub.path === "original" ? sub.original_premise : sub.preset_title;
  const characters: Array<{ name: string; description: string }> = sub.characters || [];
  if (characters.length === 0) {
    return new Response(JSON.stringify({ error: "This submission has no characters to generate packets for." }), { status: 409 });
  }

  const systemPrompt = `You write confessional-cast packets for The Director's Chair, a mockumentary-style filmmaking platform.

FORMAT: Real people self-shoot solo confessional monologues on their own phones. They never meet the other cast members and never see anyone else's material. Each person only knows their own character's truth \u2014 that isolation is the entire creative mechanic of the show. A packet that leaks another character's secrets, plot twists, or perspective defeats the format.

For each character given, produce:
- voice_direction: 2-3 sentences on how this specific person should perform \u2014 tone, pacing, emotional register, what they're trying to hide or reveal in front of the camera.
- riff_beats: 3-5 short talking points this character should hit in their confessional, in their own words, building toward the character's arc within the premise. These are prompts to riff on, not a script.
- sample_lines: 3-4 example lines in this character's voice, showing tone and cadence, to calibrate their performance. Not a full script.

Respond with ONLY valid JSON, no markdown fences, no preamble, no commentary. Exact shape:
{"characters":[{"name":"...","voice_direction":"...","riff_beats":["...","..."],"sample_lines":["...","..."]}]}`;

  const userPrompt = `Premise: "${premise}"${sub.path === "preset" && sub.preset_genre ? ` (${sub.preset_genre})` : ""}

Characters:
${characters.map((c, i) => `${i + 1}. ${c.name} \u2014 ${c.description}`).join("\n")}`;

  let apiRes: Response;
  try {
    apiRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: "claude-sonnet-5",
        max_tokens: 8192,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }]
      })
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: `Could not reach Claude API: ${err.message}` }), { status: 502 });
  }

  if (!apiRes.ok) {
    const errBody = await apiRes.text().catch(() => "");
    return new Response(JSON.stringify({ error: `Claude API error (${apiRes.status}): ${errBody}` }), { status: 502 });
  }

  const apiData: any = await apiRes.json();

  // Find the text block by type, never by index — a thinking block can
  // legitimately come first (confirmed happens on more complex requests).
  const textBlock = (apiData.content || []).find((b: any) => b.type === "text");
  if (!textBlock) {
    return new Response(JSON.stringify({ error: "Claude API response had no text content." }), { status: 502 });
  }

  let parsed: any;
  try {
    let raw = textBlock.text.trim();
    const fenceMatch = raw.match(/^```(?:json)?\s*\n([\s\S]*)\n```$/);
    if (fenceMatch) raw = fenceMatch[1];
    parsed = JSON.parse(raw);
  } catch (err: any) {
    return new Response(JSON.stringify({
      error: "Claude's response wasn't valid JSON after parsing.",
      rawPreview: textBlock.text.slice(0, 500)
    }), { status: 502 });
  }

  if (!Array.isArray(parsed.characters) || parsed.characters.length !== characters.length) {
    return new Response(JSON.stringify({
      error: `Expected ${characters.length} character packet(s), got ${Array.isArray(parsed.characters) ? parsed.characters.length : "none"}.`
    }), { status: 502 });
  }
  for (const c of parsed.characters) {
    if (!c.name || !c.voice_direction || !Array.isArray(c.riff_beats) || !Array.isArray(c.sample_lines)) {
      return new Response(JSON.stringify({ error: "A generated character packet is missing required fields." }), { status: 502 });
    }
  }

  const packets = {
    generated_at: new Date().toISOString(),
    characters: parsed.characters.map((c: any) => ({
      name: c.name,
      voice_direction: c.voice_direction,
      riff_beats: c.riff_beats,
      sample_lines: c.sample_lines,
      delivery_email: null,
      sent_at: null
    }))
  };

  await database.sql`
    UPDATE submissions SET generated_packets = ${JSON.stringify(packets)}, updated_at = now()
    WHERE id = ${submissionId}
  `;

  return new Response(JSON.stringify({ packets }), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
};

export const config: Config = {
  path: "/admin-generate-packets"
};
