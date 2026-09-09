import type { Context, Config } from "@netlify/functions";

// POST /admin-login
// Body: { password: string }
// This is a convenience check for the dashboard's login screen only — every
// other /admin-* function independently re-validates the password on every
// request (see lib/auth.mts). This endpoint existing does not make it the
// sole gate; it just gives the UI a fast "wrong password" response.
export default async (req: Request, context: Context) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
  }

  const expected = Netlify.env.get("ADMIN_PASSWORD");
  if (!expected) {
    return new Response(JSON.stringify({ error: "Admin auth not configured." }), { status: 500 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), { status: 400 });
  }

  if (body?.password !== expected) {
    return new Response(JSON.stringify({ error: "Incorrect password." }), { status: 401 });
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
};

export const config: Config = {
  path: "/admin-login"
};
