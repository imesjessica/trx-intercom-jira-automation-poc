import type { Mode, Tag, AppConfig } from "./types";
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

// Descriptions are written in a tiny markdown subset and converted to ADF:
//   "## Heading", "- bullet", blank-line separated paragraphs, **bold** is not parsed.
export function toAdf(text: string) {
  const content: any[] = [];
  let bullets: any[] = [];
  const flush = () => {
    if (bullets.length) {
      content.push({ type: "bulletList", content: bullets });
      bullets = [];
    }
  };
  const para = (t: string) => ({ type: "paragraph", content: [{ type: "text", text: t }] });
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      flush();
    } else if (line.startsWith("## ")) {
      flush();
      content.push({ type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: line.slice(3) }] });
    } else if (/^\s*[-*] /.test(line)) {
      bullets.push({ type: "listItem", content: [para(line.replace(/^\s*[-*] /, ""))] });
    } else {
      flush();
      content.push(para(line.trim()));
    }
  }
  flush();
  if (!content.length) content.push(para(" "));
  return { type: "doc", version: 1, content };
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

export function issueUrl(key: string): string | null {
  const base = (process.env.JIRA_BASE_URL || "").replace(/\/$/, "");
  return jiraMode() === "live" && base ? `${base}/browse/${key}` : null;
}

function authHeaders() {
  const auth = Buffer.from(`${process.env.JIRA_EMAIL}:${process.env.JIRA_API_TOKEN}`).toString("base64");
  return { Authorization: `Basic ${auth}`, Accept: "application/json", "Content-Type": "application/json" };
}

async function check(res: Response) {
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Jira ${res.status}: ${text.slice(0, 400)}`);
  }
}

export async function createIssue(args: {
  tag: Tag;
  summary: string;
  description: string;
  seed: string; // stable string used to make sample-mode keys
}): Promise<CreatedIssue> {
  const cfg = appConfig();

  if (jiraMode() === "mock") {
    await sleep(700);
    return { key: `${cfg.project}-${100 + (hash(args.seed + args.tag) % 900)}`, url: null };
  }

  const base = process.env.JIRA_BASE_URL!.replace(/\/$/, "");
  const res = await fetch(`${base}/rest/api/3/issue`, {
    method: "POST",
    headers: authHeaders(),
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
  await check(res);
  const data = await res.json();
  return { key: data.key, url: `${base}/browse/${data.key}` };
}

// Rewrites summary and description (for example after tickets were added to or
// removed from the issue). Tag is only needed when the tag itself is overridden,
// which also swaps the label and issue type; Jira only allows that if the
// project's workflow permits it.
export async function updateIssue(args: {
  key: string;
  summary: string;
  description: string;
  tag?: Tag;
}): Promise<void> {
  const cfg = appConfig();
  if (jiraMode() === "mock") {
    await sleep(400);
    return;
  }
  const base = process.env.JIRA_BASE_URL!.replace(/\/$/, "");
  const fields: Record<string, unknown> = {
    summary: args.summary.slice(0, 250),
    description: toAdf(args.description),
  };
  const body: Record<string, unknown> = { fields };
  if (args.tag) {
    fields.issuetype = { name: cfg.issueTypes[args.tag] };
    const other: Tag = args.tag === "product_bug" ? "product_feedback" : "product_bug";
    body.update = { labels: [{ remove: other }, { add: args.tag }] };
  }
  const res = await fetch(`${base}/rest/api/3/issue/${encodeURIComponent(args.key)}`, {
    method: "PUT",
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
  await check(res);
}

// Short audit-trail comment, e.g. "Intercom 2151... was moved out of this issue".
export async function addComment(args: { key: string; text: string }): Promise<void> {
  if (jiraMode() === "mock") {
    await sleep(200);
    return;
  }
  const base = process.env.JIRA_BASE_URL!.replace(/\/$/, "");
  const res = await fetch(`${base}/rest/api/3/issue/${encodeURIComponent(args.key)}/comment`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ body: toAdf(args.text) }),
  });
  await check(res);
}
