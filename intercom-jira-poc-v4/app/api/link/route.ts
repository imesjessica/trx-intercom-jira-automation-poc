import { NextResponse } from "next/server";
import { recordJiraLink, removeJiraLink, applyTag, intercomMode, REVIEWED_TAG } from "@/lib/intercom";
import { TAGS, type Tag } from "@/lib/types";

export const dynamic = "force-dynamic";

const JIRA_KEY = /^[A-Z][A-Z0-9]*-\d+$/;

function parse(b: { id?: string; key?: string; tag?: string; url?: string | null }) {
  if (!b.id || !b.key || !JIRA_KEY.test(b.key) || !b.tag || !TAGS.includes(b.tag as Tag)) return null;
  return { id: b.id, key: b.key, tag: b.tag as Tag, url: b.url ?? null };
}

// Link a conversation to a Jira issue (stores a jira-bug-KEY / jira-feedback-KEY tag)
export async function POST(req: Request) {
  try {
    const p = parse(await req.json());
    if (!p) return NextResponse.json({ error: "Body must include id, key, tag" }, { status: 400 });
    await recordJiraLink(p.id, p.key, p.tag, p.url);
    return NextResponse.json({ ok: true, mode: intercomMode() });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Link failed" }, { status: 502 });
  }
}

// Unlink a conversation from a Jira issue
export async function DELETE(req: Request) {
  try {
    const p = parse(await req.json());
    if (!p) return NextResponse.json({ error: "Body must include id, key, tag" }, { status: 400 });
    await removeJiraLink(p.id, p.key, p.tag);
    return NextResponse.json({ ok: true, mode: intercomMode() });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Unlink failed" }, { status: 502 });
  }
}

// Mark a conversation as manually reviewed so automation leaves it alone
export async function PUT(req: Request) {
  try {
    const { id } = (await req.json()) as { id?: string };
    if (!id) return NextResponse.json({ error: "Body must include id" }, { status: 400 });
    await applyTag(id, REVIEWED_TAG);
    return NextResponse.json({ ok: true, mode: intercomMode() });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Mark reviewed failed" }, { status: 502 });
  }
}
