import { NextResponse } from "next/server";
import { relateIssues, jiraMode } from "@/lib/jira";

export const dynamic = "force-dynamic";

const JIRA_KEY = /^[A-Z][A-Z0-9]*-\d+$/;

// Create a "Relates to" link between two Jira issues
export async function POST(req: Request) {
  try {
    const { a, b } = (await req.json()) as { a?: string; b?: string };
    if (!a || !b || !JIRA_KEY.test(a) || !JIRA_KEY.test(b) || a === b) {
      return NextResponse.json({ error: "Body must include two different valid Jira keys, a and b" }, { status: 400 });
    }
    await relateIssues({ a, b });
    return NextResponse.json({ ok: true, mode: jiraMode() });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Jira link failed" }, { status: 502 });
  }
}
