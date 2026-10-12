import { NextResponse } from "next/server";
import { applyTag, removeTag, intercomMode } from "@/lib/intercom";
import { TAGS, type Tag } from "@/lib/types";

export const dynamic = "force-dynamic";

async function readBody(req: Request): Promise<{ id: string; tag: Tag } | null> {
  const { id, tag } = (await req.json()) as { id?: string; tag?: string };
  if (!id || !tag || !TAGS.includes(tag as Tag)) return null;
  return { id, tag: tag as Tag };
}

const BAD_BODY = "Body must include id and tag (product_feedback | product_bug)";

// Add a tag
export async function POST(req: Request) {
  try {
    const body = await readBody(req);
    if (!body) return NextResponse.json({ error: BAD_BODY }, { status: 400 });
    await applyTag(body.id, body.tag);
    return NextResponse.json({ ok: true, ...body, mode: intercomMode() });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Tagging failed" }, { status: 502 });
  }
}

// Remove a tag
export async function DELETE(req: Request) {
  try {
    const body = await readBody(req);
    if (!body) return NextResponse.json({ error: BAD_BODY }, { status: 400 });
    await removeTag(body.id, body.tag);
    return NextResponse.json({ ok: true, ...body, mode: intercomMode() });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Removing tag failed" }, { status: 502 });
  }
}
