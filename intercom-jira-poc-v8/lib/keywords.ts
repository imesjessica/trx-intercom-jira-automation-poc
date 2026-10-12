import type { Tag } from "./types";
import { TAGS } from "./types";

// ---------------------------------------------------------------------------
// Edit these two lists to change what gets highlighted and auto-tagged.
// A trailing * matches word endings: "fail*" matches fail, failed, failing,
// failure. Without the *, only the exact word or phrase matches.
// Matching is case-insensitive.
// ---------------------------------------------------------------------------
export const BUG_TERMS = [
  "issue", // exact on purpose: "issued" is common in court language ("issued an order")
  "issues",
  "problem*",
  "bug*",
  "error*",
  "crash*",
  "broken",
  "fail*",
  "not working",
  "isn't working",
  "doesn't work",
  "does not work",
  "stuck",
  "timeout*",
  "timed out",
  "times out",
  "time out",
  "500",
  "blank",
  "missing",
  "can't",
  "cannot",
  "unable",
  "wrong",
  "incorrect",
  "unexpected",
  "duplicate*",
  "never arrives",
  "didn't",
  "glitch*",
  "freez*",
  "frozen",
  "not loading",
  "won't load",
  "regression*",
  "outage*",
  "slow*",
  "lag*",
];

export const FEEDBACK_TERMS = [
  "would be nice",
  "would love",
  "would like",
  "wish*",
  "feature*",
  "suggest*",
  "it would help",
  "could you add",
  "add support",
  "ability to",
  "option to",
  "please consider",
  "idea*",
  "improve*",
  "enhancement*",
  "nice to have",
  "roadmap",
];

// Billing: money questions. Tagged billing_issue (stays with support, no Jira issue).
export const BILLING_TERMS = [
  "invoice*",
  "billing",
  "billed",
  "charge*",
  "refund*",
  "payment*",
  "subscription*",
  "overcharg*",
  "receipt*",
  "credit card",
  "pricing",
  "renewal",
];

// General inquiry: questions with no defect or request in them. Only used when
// nothing else matched.
export const INQUIRY_TERMS = [
  "question*",
  "wondering",
  "could you send",
  "can you send",
  "do you offer",
  "do you have",
  "how do i",
  "how can i",
  "can you confirm",
  "point of contact",
  "information about",
  "soc 2",
];

// Auto-tag fires when the winning category has at least this many hits.
// Raise to 2 to be more conservative.
export const AUTO_TAG_MIN_MATCHES = 1;

export type Kind = "bug" | "feedback" | "billing" | "inquiry";

export interface Match {
  start: number;
  end: number;
  kind: Kind;
  text: string;
}

function toRegex(term: string): RegExp {
  const stem = term.endsWith("*");
  const raw = stem ? term.slice(0, -1) : term;
  const escaped = raw
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/'/g, "['’]") // straight or curly apostrophe
    .replace(/\s+/g, "\\s+");
  return new RegExp(`\\b${escaped}${stem ? "\\w*" : "\\b"}`, "gi");
}

const COMPILED: { kind: Kind; re: RegExp }[] = [
  ...BUG_TERMS.map((t) => ({ kind: "bug" as Kind, re: toRegex(t) })),
  ...FEEDBACK_TERMS.map((t) => ({ kind: "feedback" as Kind, re: toRegex(t) })),
  ...BILLING_TERMS.map((t) => ({ kind: "billing" as Kind, re: toRegex(t) })),
  ...INQUIRY_TERMS.map((t) => ({ kind: "inquiry" as Kind, re: toRegex(t) })),
];

export function findMatches(text: string): Match[] {
  const all: Match[] = [];
  for (const { kind, re } of COMPILED) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      if (m[0].length === 0) {
        re.lastIndex++;
        continue;
      }
      all.push({ start: m.index, end: m.index + m[0].length, kind, text: m[0] });
    }
  }
  // Earliest first; if two matches start together, the longer one wins.
  all.sort((a, b) => a.start - b.start || b.end - a.end);
  const out: Match[] = [];
  let lastEnd = -1;
  for (const m of all) {
    if (m.start >= lastEnd) {
      out.push(m);
      lastEnd = m.end;
    }
  }
  return out;
}

export interface Segment {
  text: string;
  kind?: Kind;
}

// Splits text into plain and highlighted pieces, in order.
export function segment(text: string): Segment[] {
  const parts: Segment[] = [];
  let pos = 0;
  for (const m of findMatches(text)) {
    if (m.start > pos) parts.push({ text: text.slice(pos, m.start) });
    parts.push({ text: text.slice(m.start, m.end), kind: m.kind });
    pos = m.end;
  }
  if (pos < text.length) parts.push({ text: text.slice(pos) });
  return parts;
}

export interface Suggestion {
  tag: Tag | null;
  matched: string[]; // distinct words that triggered the suggestion
  total: number; // number of hits for the winning category
}

// Same shape the UI already used, so it is a drop-in replacement for classify.ts.
export function suggestTag(subject: string, body: string): Suggestion {
  const matches = findMatches(`${subject}\n${body}`);
  const bug = matches.filter((m) => m.kind === "bug");
  const fb = matches.filter((m) => m.kind === "feedback");
  if (bug.length === 0 && fb.length === 0) return { tag: null, matched: [], total: 0 };

  const isBug = bug.length >= fb.length; // ties go to bug
  const winner = isBug ? bug : fb;
  return {
    tag: isBug ? "product_bug" : "product_feedback",
    matched: Array.from(new Set(winner.map((m) => m.text.toLowerCase()))).slice(0, 4),
    total: winner.length,
  };
}

export interface MultiSuggestion {
  tags: Tag[]; // not exclusive: a ticket can be several
  matched: Record<Tag, string[]>;
  total: Record<Tag, number>;
}

const KIND_TAG: Record<Kind, Tag> = {
  bug: "product_bug",
  feedback: "product_feedback",
  billing: "billing_issue",
  inquiry: "general_inquiry",
};

// Bug, feature request and billing are independent. General inquiry is only
// suggested when nothing else matched (a question with no defect or request).
export function suggestTags(subject: string, body: string): MultiSuggestion {
  const matches = findMatches(`${subject}\n${body}`);
  const matched = {} as Record<Tag, string[]>;
  const total = {} as Record<Tag, number>;
  for (const tag of TAGS) {
    matched[tag] = [];
    total[tag] = 0;
  }
  for (const kind of Object.keys(KIND_TAG) as Kind[]) {
    const list = matches.filter((m) => m.kind === kind);
    const tag = KIND_TAG[kind];
    total[tag] = list.length;
    matched[tag] = Array.from(new Set(list.map((m) => m.text.toLowerCase()))).slice(0, 4);
  }
  const tags: Tag[] = TAGS.filter((t) => t !== "general_inquiry" && total[t] >= AUTO_TAG_MIN_MATCHES);
  if (tags.length === 0 && total.general_inquiry >= AUTO_TAG_MIN_MATCHES) tags.push("general_inquiry");
  return { tags, matched, total };
}
