import { getDatabase } from "@netlify/database";

// Single shared entry point for the DB driver — every function imports this
// instead of calling getDatabase() directly, so connection handling stays
// in one place.
export function db() {
  return getDatabase();
}
