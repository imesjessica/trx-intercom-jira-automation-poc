import { NextResponse } from "next/server";
import { createIssue, updateIssue, jiraMode } from "@/lib/jira";
import { recordJiraLink } from "@/lib/intercom";
import { TAGS, type Tag } from "@/lib/types";

export const dynamic = "force-dynamic";

const JIRA_KEY = /^[A-Z][A-Z0-9]*-\d+$/;

// Create a Jira issue for a ticket
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

    // Close the loop in Intercom: internal note + a jira-KEY tag that remembers the link.
    let linked = false;
    try {
      await recordJiraLink(ticket.id, issue.key, issue.url);
      linked = true;
    } catch {
      linked = false;
    }

    return NextResponse.json({ ok: true, issue, mode: jiraMode(), linked });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Jira create failed" }, { status: 502 });
  }
}

// Update the existing Jira issue after support overrides the tag
export async function PUT(req: Request) {
  try {
    const { key, tag, summary, description } = (await req.json()) as {
      key?: string;
      tag?: string;
      summary?: string;
      description?: string;
    };

    if (!key || !JIRA_KEY.test(key) || !tag || !TAGS.includes(tag as Tag) || !summary || !description) {
      return NextResponse.json({ error: "Body must include a valid Jira key, tag, summary, description" }, { status: 400 });
    }

    await updateIssue({ key, tag: tag as Tag, summary, description });
    return NextResponse.json({ ok: true, key, mode: jiraMode() });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Jira update failed" }, { status: 502 });
  }
}
