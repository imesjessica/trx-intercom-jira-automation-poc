import type { Tag } from "./types";

// Deliberately simple keyword scoring so the demo needs no extra credentials.
// In the real build this is where an LLM call (or Intercom's own AI categories)
// would plug in. The human still confirms the tag in the UI.
const BUG_WORDS = [
  "error",
  "crash",
  "broken",
  "fails",
  "failed",
  "failing",
  "not working",
  "doesn't work",
  "does not work",
  "stuck",
  "timeout",
  "timed out",
  "500",
  "blank",
  "missing",
  "can't",
  "cannot",
  "unable",
  "wrong",
  "duplicate",
  "never arrives",
  "didn't",
];

const FEEDBACK_WORDS = [
  "would be nice",
  "would love",
  "wish",
  "feature request",
  "suggestion",
  "suggest",
  "it would help",
  "could you add",
  "add support",
  "ability to",
  "option to",
  "please consider",
  "would like",
  "idea",
  "improve",
];

export interface Suggestion {
  tag: Tag | null;
  matched: string[];
}

export function suggestTag(subject: string, body: string): Suggestion {
  const text = `${subject} ${body}`.toLowerCase();
  const bug = BUG_WORDS.filter((w) => text.includes(w));
  const fb = FEEDBACK_WORDS.filter((w) => text.includes(w));
  if (bug.length === 0 && fb.length === 0) return { tag: null, matched: [] };
  if (bug.length >= fb.length) return { tag: "product_bug", matched: bug.slice(0, 4) };
  return { tag: "product_feedback", matched: fb.slice(0, 4) };
}
