import type { Context, Config } from "@netlify/functions";
import { db } from "./lib/db.mts";

// POST /submit-casting
// Body: { country, city, age, gender, email, handles: [{platform, handle}] }
// Mirrors directors-chair-cast-profile.html's real field set exactly.
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

  const { country, city, age, gender, email, handles } = body || {};

  if (!country?.trim() || !city?.trim()) {
    return new Response(JSON.stringify({ error: "Country and city are required." }), { status: 400 });
  }
  const ageNum = Number(age);
  if (!Number.isInteger(ageNum) || ageNum < 18 || ageNum > 100) {
    return new Response(JSON.stringify({ error: "Age must be 18 or older." }), { status: 400 });
  }
  if (!gender?.trim()) {
    return new Response(JSON.stringify({ error: "Gender is required." }), { status: 400 });
  }
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email || "");
  if (!emailValid) {
    return new Response(JSON.stringify({ error: "A valid email is required." }), { status: 400 });
  }
  if (!Array.isArray(handles) || handles.length === 0) {
    return new Response(JSON.stringify({ error: "At least one social handle is required." }), { status: 400 });
  }

  const database = db();
  const [applicant] = await database.sql`
    INSERT INTO casting_applicants (country, city, age, gender, email, handles)
    VALUES (${country.trim()}, ${city.trim()}, ${ageNum}, ${gender.trim()}, ${email.trim().toLowerCase()}, ${JSON.stringify(handles)})
    RETURNING id
  `;

  return new Response(JSON.stringify({ applicantId: applicant.id }), {
    status: 201,
    headers: { "content-type": "application/json" }
  });
};

export const config: Config = {
  path: "/submit-casting"
};
