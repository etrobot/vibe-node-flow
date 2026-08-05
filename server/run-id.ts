import { randomBytes } from "node:crypto";

/** Return a compact numeric run id using the server's local time. */
export function makeRunId(now = new Date()): string {
  const yy = String(now.getFullYear()).slice(-2);
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  const seconds = String(now.getSeconds()).padStart(2, "0");
  // The timestamp remains useful when reading run history, while the random
  // suffix prevents concurrent runs in the same second from sharing a DB key
  // or overwriting each other's run-scoped assets.
  return `${yy}${month}${day}${hours}${minutes}${seconds}-${randomBytes(4).toString("hex")}`;
}
