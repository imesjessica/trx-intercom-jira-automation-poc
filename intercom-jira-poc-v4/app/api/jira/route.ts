import { NextResponse } from "next/server";
import { createIssue, updateIssue, addComment, jiraMode } from "@/lib/jira";
import { TAGS, type Tag } from "@/lib/types";

export const dynamic = "force-dynamic";

const JIRA_KEY = /^[A-Z][A-Z0-9]*-\d+$/;

// Create a Jira issue. Linking conversations to it is a separate call (/api/link),
// so one issue can cover many conversations.
export async function POST(req: Request) {
  try {
    const { tag, summary, description, seed } = (await req.json()) as {
      tag?: string;
      summary?: string;
      description?: string;
      seed?: string;
    };
    if (!tag || !TAGS.includes(tag as Tag) || !summary || !description || !seed) {
      return NextResponse.json({ error: "Body must include tag, summary, description, seed" }, { status: 400 });
    }
    const issue = await createIssue({ tag: tag as Tag, summary, description, seed });
    return NextResponse.json({ ok: true, issue, mode: jiraMode() });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Jira create failed" }, { status: 502 });
  }
}

// Update an existing issue (membership changed, or tag overridden) and optionally leave a comment
export async function PUT(req: Request) {
  try {
    const { key, tag, summary, description, comment } = (await req.json()) as {
      key?: string;
      tag?: string;
      summary?: string;
      description?: string;
      comment?: string;
    };
    if (!key || !JIRA_KEY.test(key) || !summary || !description || (tag && !TAGS.includes(tag as Tag))) {
      return NextResponse.json({ error: "Body must include a valid Jira key, summary, description" }, { status: 400 });
    }
    await updateIssue({ key, summary, description, tag: tag as Tag | undefined });
    if (comment) await addComment({ key, text: comment });
    return NextResponse.json({ ok: true, key, mode: jiraMode() });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Jira update failed" }, { status: 502 });
  }
}

// Comment only (for example "this issue no longer has any linked conversations")
export async function PATCH(req: Request) {
  try {
    const { key, comment } = (await req.json()) as { key?: string; comment?: string };
    if (!key || !JIRA_KEY.test(key) || !comment) {
      return NextResponse.json({ error: "Body must include a valid Jira key and comment" }, { status: 400 });
    }
    await addComment({ key, text: comment });
    return NextResponse.json({ ok: true, key, mode: jiraMode() });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Jira comment failed" }, { status: 502 });
  }
}
