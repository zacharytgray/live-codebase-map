import { openSync, writeSync, closeSync } from "node:fs";
import { join } from "node:path";

// append a batch to the durable log in one O_APPEND write.
export function appendEvents(codemapDir: string, events: Record<string, unknown>[]): void {
  if (!events.length) return;
  const data = events.map((e) => JSON.stringify(e)).join("\n") + "\n";
  const fd = openSync(join(codemapDir, "events.jsonl"), "a");
  try {
    writeSync(fd, data);
  } finally {
    closeSync(fd);
  }
}
