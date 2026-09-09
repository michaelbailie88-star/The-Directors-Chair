import type { Config } from "@netlify/functions";
import { db } from "./lib/db.mts";

// Runs daily. Closes any submission still sitting in Second Look once its
// 30-day window has passed, per the locked spec: no refund, no credit, no
// renewal once the window closes. This keeps the admin queue accurate
// without Michael having to manually track expiry dates.
export default async (req: Request) => {
  const database = db();
  await database.sql`
    UPDATE submissions
    SET status = 'closed', updated_at = now()
    WHERE status = 'second_look' AND second_look_expires < now()
  `;
};

export const config: Config = {
  schedule: "@daily"
};
