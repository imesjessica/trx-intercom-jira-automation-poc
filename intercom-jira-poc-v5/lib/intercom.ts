import type { JiraLink, Mode, Tag, Ticket, TicketStatus } from "./types";
import { TAGS, TAG_INFO } from "./types";
import { MOCK_TICKETS } from "./mock";

const BASE = "https://api.intercom.io";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function intercomMode(): Mode {
  if (process.env.DEMO_FORCE_MOCK === "true") return "mock";
  return process.env.INTERCOM_ACCESS_TOKEN ? "live" : "mock";
}

function headers() {
  return {
    Authorization: `Bearer ${process.env.INTERCOM_ACCESS_TOKEN}`,
    Accept: "application/json",
    "Content-Type": "application/json",
    "Intercom-Version": "2.11",
  };
}

async function icFetch(path: string, init?: RequestInit) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { ...headers(), ...(init?.headers ?? {}) },
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Intercom ${res.status} on ${path}: ${text.slice(0, 300)}`);
  }
  return res.json();
}

function stripHtml(html: string): string {
  return (html || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Jira links are remembered inside Intercom as tags named
// "jira-bug-KEY" or "jira-feedback-KEY" (for example "jira-bug-TRX-123").
// On the next load we read them back: that is how several conversations are
// known to share one Jira issue, and what stops duplicate issues on reload.
const JIRA_TAG = /^jira-(bug|feedback|inquiry|billing)-([A-Z][A-Z0-9]*-\d+)$/;
export const REVIEWED_TAG = "triage-reviewed";

export function jiraTagName(key: string, tag: Tag): string {
  return `jira-${TAG_INFO[tag].short}-${key}`;
}

export async function listTickets(): Promise<Ticket[]> {
  if (intercomMode() === "mock") {
    await sleep(400);
    return MOCK_TICKETS;
  }

  // Conversations API. Intercom's separate "Tickets" object is a near drop-in
  // swap (tickets/search + tickets/{id}/tags) if TRX uses ticket types.
  const data = await icFetch("/conversations?per_page=15&order=desc&sort=updated_at");
  const conversations: any[] = data.conversations ?? [];
  const jiraBase = (process.env.JIRA_BASE_URL || "").replace(/\/$/, "");

  return conversations.map((c) => {
    const body = stripHtml(c.source?.body ?? "");
    const subject = (c.source?.subject && stripHtml(c.source.subject)) || body.slice(0, 80) || "(no subject)";
    const names: string[] = (c.tags?.tags ?? []).map((t: any) => t.name);
    const links: JiraLink[] = [];
    for (const n of names) {
      const m = JIRA_TAG.exec(n);
      if (m) {
        links.push({
          key: m[2],
          tag: (TAGS.find((x) => TAG_INFO[x].short === m[1]) ?? "product_bug") as Tag,
          url: jiraBase ? `${jiraBase}/browse/${m[2]}` : null,
        });
      }
    }
    const appId = process.env.INTERCOM_APP_ID;
    const state: TicketStatus = c.state === "closed" ? "closed" : c.state === "snoozed" ? "snoozed" : "open";
    const adminReply: number | undefined = c.statistics?.last_admin_reply_at || undefined;
    return {
      id: String(c.id),
      subject,
      body,
      customer: {
        name: c.source?.author?.name || "Unknown",
        org: c.source?.author?.email || "",
      },
      createdAt: new Date((c.created_at ?? 0) * 1000).toISOString(),
      tags: names,
      status: state,
      followedUp: Boolean(adminReply),
      lastAdminReplyAt: adminReply ? new Date(adminReply * 1000).toISOString() : undefined,
      reviewed: names.includes(REVIEWED_TAG),
      intercomUrl: appId ? `https://app.intercom.com/a/inbox/${appId}/inbox/conversation/${c.id}` : null,
      jira: links,
    } satisfies Ticket;
  });
}

// Creates the tag if needed (Intercom returns the existing tag when the name
// already exists) and returns its id.
async function tagId(name: string): Promise<string> {
  const created = await icFetch("/tags", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
  return created.id;
}

export async function applyTag(conversationId: string, tag: string): Promise<void> {
  if (intercomMode() === "mock") {
    await sleep(500);
    return;
  }
  const adminId = process.env.INTERCOM_ADMIN_ID;
  if (!adminId) throw new Error("INTERCOM_ADMIN_ID is not set");

  await icFetch(`/conversations/${conversationId}/tags`, {
    method: "POST",
    body: JSON.stringify({ id: await tagId(tag), admin_id: adminId }),
  });
}

export async function removeTag(conversationId: string, tag: string): Promise<void> {
  if (intercomMode() === "mock") {
    await sleep(400);
    return;
  }
  const adminId = process.env.INTERCOM_ADMIN_ID;
  if (!adminId) throw new Error("INTERCOM_ADMIN_ID is not set");

  await icFetch(`/conversations/${conversationId}/tags/${await tagId(tag)}`, {
    method: "DELETE",
    body: JSON.stringify({ admin_id: adminId }),
  });
}

// Best-effort: leave an internal note on the conversation linking to Jira.
export async function addJiraNote(conversationId: string, text: string): Promise<void> {
  if (intercomMode() === "mock") return;
  const adminId = process.env.INTERCOM_ADMIN_ID;
  if (!adminId) return;
  await icFetch(`/conversations/${conversationId}/reply`, {
    method: "POST",
    body: JSON.stringify({ message_type: "note", type: "admin", admin_id: adminId, body: text }),
  });
}

// After a conversation is attached to a Jira issue: leave a note and store the link as a tag.
export async function recordJiraLink(conversationId: string, key: string, tag: Tag, url: string | null): Promise<void> {
  if (intercomMode() === "mock") return;
  await addJiraNote(conversationId, `Linked to Jira: ${key}${url ? ` (${url})` : ""}`);
  await applyTag(conversationId, jiraTagName(key, tag));
}

// Override: this conversation no longer belongs to that Jira issue.
export async function removeJiraLink(conversationId: string, key: string, tag: Tag): Promise<void> {
  if (intercomMode() === "mock") return;
  await removeTag(conversationId, jiraTagName(key, tag));
  await addJiraNote(conversationId, `Unlinked from Jira: ${key}`);
}
