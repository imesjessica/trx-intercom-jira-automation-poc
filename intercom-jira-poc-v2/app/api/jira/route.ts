import { NextResponse } from "next/server";
import { createIssue, jiraMode } from "@/lib/jira";
import { addJiraNote } from "@/lib/intercom";
import { TAGS, type Tag } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      ticket?: { id?: string; subject?: string };
      tag?: string;
      summary?: string;
      description?: string;
    };
    const { ticket, tag, summary, description } = body;

    if (!ticket?.id || !ticket.subject || !tag || !TAGS.includes(tag as Tag) || !summary || !description) {
      return NextResponse.json({ error: "Body must include ticket {id, subject}, tag, summary, description" }, { status: 400 });
    }

    const issue = await createIssue({
      ticket: { id: ticket.id, subject: ticket.subject },
      tag: tag as Tag,
      summary,
      description,
    });

    // Close the loop in Intercom so support can see the engineering link.
    let noted = false;
    try {
      await addJiraNote(ticket.id, `Escalated to Jira: ${issue.key}${issue.url ? ` (${issue.url})` : ""}`);
      noted = true;
    } catch {
      noted = false;
    }

    return NextResponse.json({ ok: true, issue, mode: jiraMode(), noted });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Jira create failed" }, { status: 502 });
  }
}
