import type { Tag, Ticket } from "./types";
import { tagLabel } from "./types";
import { assessUrgency } from "./urgency";

// Builds the Jira summary and description: user story + mini PRD + the original
// Intercom conversation(s) quoted in full.
// Template-generated from the ticket text (no AI). Sections that need a human
// decision say so, so engineers know what to confirm.
// The markup is a tiny markdown subset ("## heading", "- bullet", "> quote",
// "[text](url)") that lib/jira.ts converts to Jira's document format.

function persona(org: string): string {
  const o = org.toLowerCase();
  if (/administrator|aoc/.test(o)) return "court administrator";
  if (/\bit\b|technology/.test(o)) return "court IT administrator";
  if (/clerk/.test(o)) return "court clerk";
  return "court staff member";
}

const clean = (s: string) => s.replace(/\s+/g, " ").replace(/[?.!]+$/, "").trim();
const lowerFirst = (s: string) => (/^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s);

function firstSentences(text: string, n = 2): string {
  const parts = text.replace(/\s+/g, " ").match(/[^.!?]+[.!?]*/g) ?? [text];
  return parts.slice(0, n).join(" ").trim();
}

// "2026-10-12 15:42 UTC"
export const stamp = (iso: string) => iso.slice(0, 16).replace("T", " ") + " UTC";

export function buildSummary(tag: Tag, members: Pick<Ticket, "subject">[]): string {
  const prefix = `[${tagLabel(tag)}]`;
  const base = clean(members[0]?.subject ?? "Untitled");
  const extra = members.length > 1 ? ` (+${members.length - 1} similar)` : "";
  return `${prefix} ${base}${extra}`;
}

export function urgencyOf(t: Ticket) {
  return t.urgency ?? assessUrgency(t.subject, t.body);
}

export function buildLabels(members: Ticket[]): string[] {
  const u = members.map(urgencyOf);
  const out: string[] = [];
  if (u.some((x) => x.churnRisk)) out.push("churn-risk");
  if (u.some((x) => x.level === "high")) out.push("urgent");
  return out;
}

export function buildDescription(tag: Tag, members: Ticket[]): string {
  const lead = members[0];
  const who = persona(lead.customer.org);
  const subject = clean(lead.subject);
  const L: string[] = [];

  L.push("## User story");
  if (tag === "product_bug") {
    L.push(`As a ${who}, I want this problem fixed ("${subject}"), so that I can serve court-record requesters without manual workarounds.`);
  } else {
    L.push(`As a ${who}, I want ${lowerFirst(subject)}, so that I can handle court-record requests more efficiently.`);
  }
  L.push("");

  // Customer urgency (AI or keywords, whichever the app used)
  const ups = members.map((m) => ({ m, u: urgencyOf(m) }));
  const worst = ups.find((x) => x.u.level === "high") ?? ups.find((x) => x.u.level === "medium") ?? ups[0];
  L.push("## Customer urgency");
  L.push(
    `${worst.u.level.toUpperCase()}${ups.some((x) => x.u.churnRisk) ? ", CHURN RISK: a customer is upset and may cancel" : ""}` +
      ` (${worst.u.source === "ai" ? "assessed by AI" : "keyword rules"}).`
  );
  for (const r of worst.u.reasons) L.push(`- ${r}`);
  L.push("");

  L.push("## Problem statement");
  L.push(firstSentences(lead.body, 3));
  L.push("");

  L.push("## Requirements");
  if (tag === "product_bug") {
    L.push("- Expected behavior: the feature works as described in the user story, with no error or stall.");
    L.push("- Actual behavior: see the original conversations below.");
    L.push("- Steps to reproduce: TBD, engineering to confirm with the customer details below.");
  } else {
    L.push("- Meets the goal in the user story above.");
    L.push("- Scope, permissions and defaults: TBD, product to define.");
  }
  L.push("");

  L.push("## Acceptance criteria");
  if (tag === "product_bug") {
    L.push("- Given the scenario reported below, when the user repeats it, then it completes without error.");
    L.push("- Affected customers are told when the fix ships.");
  } else {
    L.push("- Given an authorized user, when they use the new capability, then the goal in the user story is achieved.");
    L.push("- Existing workflows are unchanged for users who do not opt in.");
  }
  L.push("");

  L.push("## Success metrics");
  L.push(
    tag === "product_bug"
      ? "- New conversations about this issue drop to zero after release."
      : "- Adoption among the requesting courts; fewer requests asking for this."
  );
  L.push("");
  L.push("## Open questions");
  L.push("- Priority and affected customer count: TBD.");
  L.push("- Does this overlap with an existing Jira issue? (The app grouped by text similarity; check before starting.)");
  L.push("");

  L.push(`## Original Intercom ${members.length === 1 ? "conversation" : "conversations"} (${members.length})`);
  for (const m of members) {
    const link = m.intercomUrl ? `[Open in Intercom](${m.intercomUrl})` : `Intercom conversation ${m.id}`;
    L.push(`${link}`);
    L.push(`- From: ${m.customer.name}, ${m.customer.org || "unknown org"}`);
    L.push(`- Received: ${stamp(m.createdAt)}`);
    L.push(`- Intercom status: ${m.status}${m.followedUp ? `, followed up${m.lastAdminReplyAt ? ` ${stamp(m.lastAdminReplyAt)}` : ""}` : ", no reply yet"}`);
    L.push(`- Subject: ${m.subject}`);
    L.push("");
    for (const line of m.body.split(/\n+/).filter(Boolean)) L.push(`> ${line}`);
    L.push("");
  }
  L.push("Generated from Intercom by the support-to-engineering handoff POC.");
  return L.join("\n");
}
