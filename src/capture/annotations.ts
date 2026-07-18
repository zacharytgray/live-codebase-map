import { annotation, type EventCtx } from "../shared/events.js";

// build annotation events from the turn's final assistant message.
// two origins: deliberate MAP: notes (stated) and a scrape of the turn text (inferred).
export function buildAnnotations(
  ctx: EventCtx,
  message: string,
  changedFiles: string[],
): Record<string, unknown>[] {
  const events: Record<string, unknown>[] = [];
  const msg = message ?? "";

  for (const line of msg.split(/\r?\n/)) {
    const m = /^MAP:\s*(.+)$/.exec(line.trim());
    if (!m) continue;
    const content = m[1].trim();
    let targets = changedFiles;
    let text = content;
    // optional "<target-hint> -> <text>" form (spaced arrow to avoid false hits)
    const idx = content.indexOf(" -> ");
    if (idx !== -1) {
      const hint = content.slice(0, idx).trim();
      const rest = content.slice(idx + 4).trim();
      if (hint && rest) {
        text = rest;
        const matched = changedFiles.filter((f) => f.toLowerCase().includes(hint.toLowerCase()));
        targets = matched.length ? matched : changedFiles;
      }
    }
    events.push(annotation(ctx, targets, text, "map-note", "stated"));
  }

  // turn-text: first ~300 chars, MAP: lines + fenced code stripped
  const clean = stripForTurnText(msg);
  if (clean) events.push(annotation(ctx, changedFiles, clean.slice(0, 300), "turn-text", "inferred"));

  return events;
}

function stripForTurnText(msg: string): string {
  let s = msg.replace(/```[\s\S]*?```/g, " ");
  s = s
    .split(/\r?\n/)
    .filter((l) => !/^MAP:\s*/.test(l.trim()))
    .join("\n");
  return s.replace(/\s+/g, " ").trim();
}
