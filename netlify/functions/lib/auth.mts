// Shared admin-auth check for every /admin/* API function.
// Solo-operator auth: one shared secret, stored as a Netlify env var
// (ADMIN_PASSWORD), never in code. The admin dashboard sends it as a
// Bearer token after login; each admin function verifies it independently
// so there is no single point that, if skipped, exposes every endpoint.
export function requireAdmin(req: Request): Response | null {
  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  const expected = Netlify.env.get("ADMIN_PASSWORD");

  if (!expected) {
    // Fails closed: if the env var was never set, nobody gets in —
    // not "nobody gets checked."
    return new Response(JSON.stringify({ error: "Admin auth not configured." }), {
      status: 500,
      headers: { "content-type": "application/json" }
    });
  }
  if (token !== expected) {
    return new Response(JSON.stringify({ error: "Unauthorized." }), {
      status: 401,
      headers: { "content-type": "application/json" }
    });
  }
  return null; // null = authorized, caller proceeds
}
