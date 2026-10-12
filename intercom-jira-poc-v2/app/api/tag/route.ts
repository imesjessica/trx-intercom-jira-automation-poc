import { NextResponse } from "next/server";
import { applyTag, intercomMode } from "@/lib/intercom";
import { TAGS, type Tag } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const { id, tag } = (await req.json()) as { id?: string; tag?: string };
    if (!id || !tag || !TAGS.includes(tag as Tag)) {
      return NextResponse.json({ error: "Body must include id and tag (product_feedback | product_bug)" }, { status: 400 });
    }
    await applyTag(id, tag as Tag);
    return NextResponse.json({ ok: true, id, tag, mode: intercomMode() });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Tagging failed" }, { status: 502 });
  }
}
