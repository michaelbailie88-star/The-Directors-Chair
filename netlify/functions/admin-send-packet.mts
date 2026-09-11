import type { Context, Config } from "@netlify/functions";
import { db } from "./lib/db.mts";
import { requireAdmin } from "./lib/auth.mts";
import { sendEmail, emailShell } from "./lib/email.mts";

// POST /admin-send-packet
// Body: {
//   submissionId, characterName, email,
//   voiceDirection, riffBeats: string[], sampleLines: string[]
// }
//
// Sends whatever content is in the request body — not what's stored in the
// DB — because the admin may have edited the generated text before sending.
// Whatever actually goes out in the email becomes the new source of truth:
// this overwrites that character's entry in generated_packets with exactly
// what was sent, plus delivery_email and sent_at. If Michael edits a packet
// after it's already been sent, sending again simply re-sends with the new
// content and updates sent_at — there's no separate "draft vs sent" state
// to get out of sync.
function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

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

  const { submissionId, characterName, email, voiceDirection, riffBeats, sampleLines } = body || {};
  if (!submissionId || !characterName?.trim() || !email?.trim()) {
    return new Response(JSON.stringify({ error: "submissionId, characterName, and email are required." }), { status: 400 });
  }
  if (!voiceDirection?.trim() || !Array.isArray(riffBeats) || riffBeats.length === 0 ||
      !Array.isArray(sampleLines) || sampleLines.length === 0) {
    return new Response(JSON.stringify({ error: "Packet content is incomplete." }), { status: 400 });
  }
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailPattern.test(email.trim())) {
    return new Response(JSON.stringify({ error: "That doesn't look like a valid email address." }), { status: 400 });
  }

  const database = db();
  const [sub] = await database.sql`
    SELECT id, status, preset_title, original_premise, path, generated_packets
    FROM submissions WHERE id = ${submissionId} LIMIT 1
  `;
  if (!sub) {
    return new Response(JSON.stringify({ error: "Submission not found." }), { status: 404 });
  }
  if (sub.status !== "selected") {
    return new Response(JSON.stringify({ error: "Packets can only be sent for Selected submissions." }), { status: 409 });
  }
  const packets = sub.generated_packets;
  if (!packets || !Array.isArray(packets.characters)) {
    return new Response(JSON.stringify({ error: "No packets have been generated for this submission yet." }), { status: 409 });
  }
  const charIndex = packets.characters.findIndex((c: any) => c.name === characterName);
  if (charIndex === -1) {
    return new Response(JSON.stringify({ error: `No character named "${characterName}" in this submission's packets.` }), { status: 404 });
  }

  const premise = sub.path === "original" ? sub.original_premise : sub.preset_title;
  const sentAt = new Date().toISOString();

  try {
    await sendEmail({
      to: { email: email.trim() },
      subject: `Your confessional packet — ${characterName}`,
      htmlContent: emailShell(`
        <p style="color:#F2EDE3; font-size:16px; margin-bottom:16px;">You've been cast as <strong style="color:#E8A33D;">${escapeHtml(characterName)}</strong> in <strong>${escapeHtml(premise)}</strong>.</p>
        <p style="color:#8A8378; font-size:13px; line-height:1.6; margin-bottom:24px;">This is yours alone. Please don't share it with anyone else in the cast — the show only works if every confessional is genuinely isolated from what everyone else knows.</p>
        <p style="color:#F2EDE3; font-size:15px; font-weight:600; margin-bottom:8px;">Voice direction</p>
        <p style="color:#F2EDE3; font-size:14px; line-height:1.6; margin-bottom:20px;">${escapeHtml(voiceDirection)}</p>
        <p style="color:#F2EDE3; font-size:15px; font-weight:600; margin-bottom:8px;">Riff on these beats</p>
        <ul style="color:#F2EDE3; font-size:14px; line-height:1.7; margin-bottom:20px; padding-left:20px;">
          ${riffBeats.map((b: string) => `<li>${escapeHtml(b)}</li>`).join("")}
        </ul>
        <p style="color:#F2EDE3; font-size:15px; font-weight:600; margin-bottom:8px;">Sample lines, for tone</p>
        <ul style="color:#8A8378; font-size:14px; line-height:1.7; font-style:italic; margin-bottom:4px; padding-left:20px;">
          ${sampleLines.map((l: string) => `<li>${escapeHtml(l)}</li>`).join("")}
        </ul>
      `)
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: `Email failed to send: ${err.message}` }), { status: 502 });
  }

  packets.characters[charIndex] = {
    name: characterName,
    voice_direction: voiceDirection,
    riff_beats: riffBeats,
    sample_lines: sampleLines,
    delivery_email: email.trim(),
    sent_at: sentAt
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
  path: "/admin-send-packet"
};
