import type { Tag, Ticket } from "./types";

// Builds the Jira summary and description as a user story + mini PRD.
// This is template-generated from the ticket text (no AI). The sections that
// need a human decision say so, so engineers know what to confirm.
// The markup is a tiny markdown subset ("## heading", "- bullet") that
// lib/jira.ts converts to Jira's document format.

function persona(org: string): string {
  const o = org.toLowerCase();
  if (/administrator|aoc/.test(o)) return "court administrator";
  if (/\bit\b/.test(o)) return "court IT administrator";
  if (/clerk/.test(o)) return "court clerk";
  return "court staff member";
}

const clean = (s: string) => s.replace(/\s+/g, " ").replace(/[?.!]+$/, "").trim();
const lowerFirst = (s: string) => (/^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s);

function firstSentences(text: string, n = 2): string {
  const parts = text.replace(/\s+/g, " ").match(/[^.!?]+[.!?]*/g) ?? [text];
  return parts.slice(0, n).join(" ").trim();
}

const when = (iso: string) => iso.slice(0, 10);

export function buildSummary(tag: Tag, members: Pick<Ticket, "subject">[]): string {
  const prefix = tag === "product_bug" ? "[Bug]" : "[Feedback]";
  const base = clean(members[0]?.subject ?? "Untitled");
  const extra = members.length > 1 ? ` (+${members.length - 1} similar)` : "";
  return `${prefix} ${base}${extra}`;
}

export function buildDescription(tag: Tag, members: Ticket[]): string {
  const lead = members[0];
  const who = persona(lead.customer.org);
  const subject = clean(lead.subject);
  const L: string[] = [];

  L.push("## User story");
  if (tag === "product_bug") {
    L.push(`As a ${who}, I want to ${lowerFirst(subject)} to work as expected, so that I can serve court-record requesters without manual workarounds.`);
  } else {
    L.push(`As a ${who}, I want ${lowerFirst(subject)}, so that I can handle court-record requests more efficiently.`);
  }
  L.push("");

  L.push("## Problem statement");
  L.push(firstSentences(lead.body, 3));
  L.push("");

  L.push("## Evidence");
  L.push(`Reported by ${members.length} conversation${members.length === 1 ? "" : "s"}:`);
  for (const m of members) {
    L.push(`- Intercom ${m.id}: ${m.customer.name}, ${m.customer.org || "unknown org"} (${when(m.createdAt)}, ${m.status}${m.followedUp ? ", followed up" : ", no reply yet"})`);
  }
  L.push("");

  if (tag === "product_bug") {
    L.push("## Requirements");
    L.push("- Expected behavior: the feature works as described in the user story, with no error or stall.");
    L.push("- Actual behavior: see problem statement and the linked conversations.");
    L.push("- Steps to reproduce: TBD, engineering to confirm with the customer details above.");
    L.push("");
    L.push("## Acceptance criteria");
    L.push("- Given the scenario reported above, when the user repeats it, then it completes without error.");
    L.push("- Affected customers are told when the fix ships.");
  } else {
    L.push("## Requirements");
    L.push("- Meets the goal in the user story above.");
    L.push("- Scope, permissions and defaults: TBD, product to define.");
    L.push("");
    L.push("## Acceptance criteria");
    L.push("- Given an authorized user, when they use the new capability, then the goal in the user story is achieved.");
    L.push("- Existing workflows are unchanged for users who do not opt in.");
  }
  L.push("");

  L.push("## Success metrics");
  L.push(
    tag === "product_bug"
      ? "- Number of new conversations about this issue drops to zero after release."
      : "- Adoption among the requesting courts; fewer requests asking for this."
  );
  L.push("");
  L.push("## Open questions");
  L.push("- Priority and affected customer count: TBD.");
  L.push("- Does this overlap with an existing Jira issue? (The app grouped by text similarity; check before starting.)");
  L.push("");
  L.push("Generated from Intercom by the support-to-engineering handoff POC.");
  return L.join("\n");
}
