// Shared transactional email helper — wraps the Brevo API so every function
// sends mail the same way, with the same failure behavior: an email that
// fails to send should NEVER fail the underlying submission. A story is
// still successfully submitted even if the receipt email bounces — so every
// call site wraps this in try/catch and only logs on failure, never throws.

const BREVO_ENDPOINT = "https://api.brevo.com/v3/smtp/email";
const FROM = { name: "The Director's Chair", email: "thelazycreatorco@gmail.com" };
export const ADMIN_EMAIL = "thelazycreatorco@gmail.com";

export async function sendEmail(opts: {
  to: { email: string; name?: string };
  subject: string;
  htmlContent: string;
}) {
  const apiKey = Netlify.env.get("BREVO_API_KEY");
  if (!apiKey) {
    console.error("BREVO_API_KEY not set — skipping email send.");
    return;
  }

  const res = await fetch(BREVO_ENDPOINT, {
    method: "POST",
    headers: {
      "api-key": apiKey,
      "Content-Type": "application/json",
      "Accept": "application/json"
    },
    body: JSON.stringify({
      sender: FROM,
      to: [opts.to],
      subject: opts.subject,
      htmlContent: opts.htmlContent
    })
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error(`Brevo send failed (${res.status}): ${body}`);
  }
}

// Shared, on-brand HTML email shell so every message looks like it came
// from the same product, not a bare unstyled system email.
export function emailShell(bodyHtml: string): string {
  return `
  <div style="background:#0A0908; padding:40px 20px; font-family:Georgia,serif;">
    <div style="max-width:520px; margin:0 auto; background:#17140F; border:1px solid #2a251c; border-radius:6px; padding:36px;">
      <div style="font-size:18px; color:#F2EDE3; margin-bottom:28px;">
        The Director<span style="color:#E8A33D;">'</span>s Chair
      </div>
      ${bodyHtml}
      <div style="margin-top:32px; padding-top:20px; border-top:1px solid #2a251c; color:#8A8378; font-size:12px; font-family:monospace;">
        Confessional-cast filmmaking.
      </div>
    </div>
  </div>`;
}
