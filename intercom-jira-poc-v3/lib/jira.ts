import type { Mode, Tag, Ticket, AppConfig } from "./types";
import { intercomMode } from "./intercom";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function jiraMode(): Mode {
  if (process.env.DEMO_FORCE_MOCK === "true") return "mock";
  const { JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN, JIRA_PROJECT_KEY } = process.env;
  return JIRA_BASE_URL && JIRA_EMAIL && JIRA_API_TOKEN && JIRA_PROJECT_KEY ? "live" : "mock";
}

export function appConfig(): AppConfig {
  return {
    intercom: intercomMode(),
    jira: jiraMode(),
    project: process.env.JIRA_PROJECT_KEY || "TRX",
    issueTypes: {
      product_bug: process.env.JIRA_BUG_ISSUE_TYPE || "Bug",
      product_feedback: process.env.JIRA_FEEDBACK_ISSUE_TYPE || "Task",
    },
  };
}

function toAdf(text: string) {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => ({ type: "paragraph", content: [{ type: "text", text: p }] }));
  return { type: "doc", version: 1, content: paragraphs };
}

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

export interface CreatedIssue {
  key: string;
  url: string | null;
}

export async function createIssue(args: {
  ticket: Pick<Ticket, "id" | "subject">;
  tag: Tag;
  summary: string;
  description: string;
}): Promise<CreatedIssue> {
  const cfg = appConfig();

  if (jiraMode() === "mock") {
    await sleep(700);
    return { key: `${cfg.project}-${100 + (hash(args.ticket.id) % 900)}`, url: null };
  }

  const base = process.env.JIRA_BASE_URL!.replace(/\/$/, "");
  const auth = Buffer.from(`${process.env.JIRA_EMAIL}:${process.env.JIRA_API_TOKEN}`).toString("base64");

  const res = await fetch(`${base}/rest/api/3/issue`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      fields: {
        project: { key: cfg.project },
        summary: args.summary.slice(0, 250),
        issuetype: { name: cfg.issueTypes[args.tag] },
        labels: [args.tag, "from-intercom"],
        description: toAdf(args.description),
      },
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Jira ${res.status}: ${text.slice(0, 400)}`);
  }
  const data = await res.json();
  return { key: data.key, url: `${base}/browse/${data.key}` };
}

// Used when support overrides the tag on a ticket that already has a Jira issue:
// swaps the label, issue type, summary and description to match the new tag.
// Note: Jira only allows the issue-type change if the project's workflow
// permits it. If it refuses, the error message is passed back to the UI.
export async function updateIssue(args: {
  key: string;
  tag: Tag;
  summary: string;
  description: string;
}): Promise<void> {
  const cfg = appConfig();

  if (jiraMode() === "mock") {
    await sleep(500);
    return;
  }

  const base = process.env.JIRA_BASE_URL!.replace(/\/$/, "");
  const auth = Buffer.from(`${process.env.JIRA_EMAIL}:${process.env.JIRA_API_TOKEN}`).toString("base64");
  const other: Tag = args.tag === "product_bug" ? "product_feedback" : "product_bug";

  const res = await fetch(`${base}/rest/api/3/issue/${encodeURIComponent(args.key)}`, {
    method: "PUT",
    headers: {
      Authorization: `Basic ${auth}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      fields: {
        summary: args.summary.slice(0, 250),
        issuetype: { name: cfg.issueTypes[args.tag] },
        description: toAdf(args.description),
      },
      update: { labels: [{ remove: other }, { add: args.tag }] },
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Jira ${res.status}: ${text.slice(0, 400)}`);
  }
}
