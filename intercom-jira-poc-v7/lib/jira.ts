import type { Mode, Tag, AppConfig, JiraStatus } from "./types";
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
    ai: Boolean(process.env.ANTHROPIC_API_KEY) && process.env.DEMO_FORCE_MOCK !== "true",
    project: process.env.JIRA_PROJECT_KEY || "TRX",
    issueTypes: {
      product_bug: process.env.JIRA_BUG_ISSUE_TYPE || "Bug",
      product_feedback: process.env.JIRA_FEEDBACK_ISSUE_TYPE || "Task",
      general_inquiry: "Task",
      billing_issue: "Task",
    },
  };
}

// Descriptions are written in a tiny markdown subset and converted to ADF:
//   "## Heading", "- bullet", "> quote line", "[text](url)" links, blank-line separated paragraphs.
function inline(text: string): any[] {
  const out: any[] = [];
  const re = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;
  let pos = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > pos) out.push({ type: "text", text: text.slice(pos, m.index) });
    out.push({ type: "text", text: m[1], marks: [{ type: "link", attrs: { href: m[2] } }] });
    pos = m.index + m[0].length;
  }
  if (pos < text.length) out.push({ type: "text", text: text.slice(pos) });
  return out.length ? out : [{ type: "text", text: " " }];
}

export function toAdf(text: string) {
  const content: any[] = [];
  let bullets: any[] = [];
  let quote: any[] = [];
  const flush = () => {
    if (bullets.length) {
      content.push({ type: "bulletList", content: bullets });
      bullets = [];
    }
    if (quote.length) {
      content.push({ type: "blockquote", content: quote });
      quote = [];
    }
  };
  const para = (t: string) => ({ type: "paragraph", content: inline(t) });
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      flush();
    } else if (line.startsWith("## ")) {
      flush();
      content.push({ type: "heading", attrs: { level: 3 }, content: inline(line.slice(3)) });
    } else if (/^\s*[-*] /.test(line)) {
      if (quote.length) flush();
      bullets.push({ type: "listItem", content: [para(line.replace(/^\s*[-*] /, ""))] });
    } else if (line.startsWith(">")) {
      if (bullets.length) flush();
      quote.push(para(line.replace(/^>\s?/, "")));
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
  labels?: string[];
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
        labels: [args.tag, "from-intercom", ...(args.labels ?? [])],
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

// "Relates to" link between two Jira issues (for example the bug and the feature
// request that came out of one conversation, or two issues that look related).
export async function relateIssues(args: { a: string; b: string }): Promise<void> {
  if (jiraMode() === "mock") {
    await sleep(200);
    return;
  }
  const base = process.env.JIRA_BASE_URL!.replace(/\/$/, "");
  const res = await fetch(`${base}/rest/api/3/issueLink`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      type: { name: "Relates" },
      inwardIssue: { key: args.a },
      outwardIssue: { key: args.b },
    }),
  });
  await check(res);
}

// Current Jira workflow status for each key (To Do / In Progress / Done ...).
// Sample mode reports everything as "To Do"; the UI lets you simulate other states.
export async function getStatuses(keys: string[]): Promise<Record<string, JiraStatus>> {
  const out: Record<string, JiraStatus> = {};
  if (jiraMode() === "mock") {
    for (const k of keys) out[k] = { name: "To Do", category: "new" };
    return out;
  }
  const base = process.env.JIRA_BASE_URL!.replace(/\/$/, "");
  await Promise.all(
    keys.slice(0, 40).map(async (k) => {
      try {
        const res = await fetch(`${base}/rest/api/3/issue/${encodeURIComponent(k)}?fields=status`, { headers: authHeaders(), cache: "no-store" });
        if (!res.ok) return;
        const d = await res.json();
        const st = d.fields?.status;
        const cat = st?.statusCategory?.key;
        out[k] = { name: st?.name ?? "Unknown", category: cat === "done" ? "done" : cat === "indeterminate" ? "indeterminate" : "new" };
      } catch {
        /* leave this key without a status */
      }
    })
  );
  return out;
}
