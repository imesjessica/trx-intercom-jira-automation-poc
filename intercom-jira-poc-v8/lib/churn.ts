import type { Churn, ChurnFactor, Ticket } from "./types";
import { buildCorpus, similarity } from "./grouping";
import { assessUrgency } from "./urgency";

// ---------------------------------------------------------------------------
// Churn risk = points from visible factors, capped at 100. Every factor is
// shown in the UI and in the Jira description. Tune the numbers below; they
// are starting guesses, not fitted to real churn data.
// ---------------------------------------------------------------------------
export const CHURN_WEIGHTS = {
  leavingLanguage: 40, // "cancel", "other vendors", "not renew" (message, AI or keywords)
  highUrgency: 15, // upset / blocked right now, without leaving language
  mediumUrgency: 5,
  repeatReport: 20, // same organization reported something very similar before (per ticket, capped)
  repeatCap: 20,
  otherTicket: 3, // same organization has other tickets (per ticket, capped)
  otherCap: 6,
  unanswered24h: 15, // open with no teammate reply
  unanswered8h: 8,
  unanswered2h: 3,
  renewalSoon: 15, // account data: renews within 90 days
  highValue: 5, // account data: annual value at or above HIGH_VALUE
  billing: 10, // billing_issue tag
};
export const HIGH_VALUE = 40000;
export const BAND_HIGH = 60;
export const BAND_MEDIUM = 30;

export function computeChurn(t: Ticket, all: Ticket[], now = Date.now()): Churn {
  const W = CHURN_WEIGHTS;
  const f: ChurnFactor[] = [];
  const add = (label: string, points: number) => points > 0 && f.push({ label, points });

  // 1. What the customer said
  const u = t.urgency ?? assessUrgency(t.subject, t.body);
  if (u.churnRisk) add(`Talks about leaving${u.reasons[0] ? ` (${u.reasons[0].replace(/^mentions leaving: /, "")})` : ""}`, W.leavingLanguage);
  else if (u.level === "high") add("Upset or blocked right now", W.highUrgency);
  else if (u.level === "medium") add("Some urgency in the message", W.mediumUrgency);

  // 2. History with this organization
  const sameOrg = all.filter((o) => o.id !== t.id && o.customer.org && o.customer.org === t.customer.org);
  if (sameOrg.length) {
    const corpus = buildCorpus(all);
    const v = corpus.vec(t);
    const repeats = sameOrg.filter((o) => similarity(v, corpus.vec(o)).score >= 0.2);
    add(`Reported something similar before (${repeats.length}x)`, Math.min(repeats.length * W.repeatReport, W.repeatCap));
    const others = sameOrg.length - repeats.length;
    add(`${others} other ticket${others === 1 ? "" : "s"} from the same organization`, Math.min(others * W.otherTicket, W.otherCap));
  }

  // 3. Support experience: waiting without an answer
  if (t.status === "open" && !t.followedUp) {
    const hrs = (now - new Date(t.createdAt).getTime()) / 3600_000;
    if (hrs >= 24) add(`Waiting ${Math.round(hrs)}h with no reply`, W.unanswered24h);
    else if (hrs >= 8) add(`Waiting ${Math.round(hrs)}h with no reply`, W.unanswered8h);
    else if (hrs >= 2) add(`Waiting ${Math.round(hrs)}h with no reply`, W.unanswered2h);
  }

  // 4. Money and account (needs CRM / billing data; skipped when absent)
  if (t.tags.includes("billing_issue")) add("Billing complaint", W.billing);
  if (t.account?.renewalInDays !== undefined && t.account.renewalInDays <= 90) add(`Renews in ${t.account.renewalInDays} days`, W.renewalSoon);
  if ((t.account?.annualValue ?? 0) >= HIGH_VALUE) add("High-value account", W.highValue);

  const score = Math.min(100, f.reduce((n, x) => n + x.points, 0));
  return { score, band: score >= BAND_HIGH ? "high" : score >= BAND_MEDIUM ? "medium" : "low", factors: f };
}

export function applyChurn(tickets: Ticket[], now = Date.now()) {
  for (const t of tickets) t.churn = computeChurn(t, tickets, now);
}
