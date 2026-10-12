import type { Urgency } from "./types";

// Keyword fallback for "is this customer upset right now and about to leave?".
// When ANTHROPIC_API_KEY is set, /api/urgency asks Claude instead and this is
// only the fallback. Either way, a human can read the reasons shown in the UI.

const CHURN = [
  "cancel*",
  "terminate*",
  "switch to",
  "switching",
  "other vendor*",
  "another vendor",
  "evaluating alternatives",
  "not renew",
  "end our contract",
  "take our business",
  "leave you",
];
const ANGRY = [
  "unacceptable",
  "frustrat*",
  "furious",
  "angry",
  "upset",
  "ridiculous",
  "fed up",
  "third time",
  "again and again",
  "still not",
  "escalat*",
  "complain*",
  "disappointed",
];
const TIME = ["urgent*", "asap", "immediately", "right now", "today", "deadline", "hearing tomorrow", "blocking", "can't work", "cannot work"];

function find(text: string, terms: string[]): string[] {
  const out: string[] = [];
  for (const t of terms) {
    const stem = t.endsWith("*");
    const raw = (stem ? t.slice(0, -1) : t).replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
    const m = new RegExp(`\\b${raw}${stem ? "\\w*" : "\\b"}`, "i").exec(text);
    // "not urgent", "no rush" style negation right before the word cancels it
    if (m && !/\b(not|no|isn't|never)\s+$/i.test(text.slice(Math.max(0, m.index - 8), m.index))) out.push(m[0].toLowerCase());
  }
  return out;
}

export function assessUrgency(subject: string, body: string): Urgency {
  const text = `${subject}\n${body}`;
  const churn = find(text, CHURN);
  const angry = find(text, ANGRY);
  const time = find(text, TIME);
  const churnRisk = churn.length > 0;
  const score = (churnRisk ? 3 : 0) + Math.min(angry.length, 2) * 1.5 + Math.min(time.length, 2);
  const level = score >= 3 ? "high" : score >= 1 ? "medium" : "low";
  const reasons: string[] = [];
  if (churn.length) reasons.push(`mentions leaving: "${churn[0]}"`);
  if (angry.length) reasons.push(`upset language: ${angry.slice(0, 2).map((w) => `"${w}"`).join(", ")}`);
  if (time.length) reasons.push(`time pressure: "${time[0]}"`);
  return { level, churnRisk, reasons, source: "keywords" };
}
