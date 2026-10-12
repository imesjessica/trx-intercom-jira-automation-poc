# Support to Engineering Handoff (POC)

Fully automatic flow: **Intercom ticket -> keyword scan -> tag (`product_bug` or `product_feedback`) -> Jira issue**, with the Jira key written back to Intercom. Support can override any tag with one click.

Built with Next.js (App Router), Tailwind CSS and shadcn/ui-style components. It runs on **sample data** with zero setup, and switches each side to **live** (Intercom, Jira) independently as soon as you add credentials.

## What happens when the page loads

1. Tickets are fetched from Intercom (or the built-in sample tickets).
2. Problem words (issue, problem, error, broken, ...) and request words (would love, suggestion, ...) are highlighted in each ticket.
3. Every ticket with a clear signal is tagged automatically in Intercom, then a Jira issue is created for it automatically. Tickets with no signal are left alone.
4. Support can override: click the **x** on a tag to remove it, or click the other tag to switch. If a Jira issue already exists it is updated to match (label, issue type, summary); otherwise one is created.

**Live mode caution:** the automation runs on page load against the 15 most recent conversations and writes to the real Intercom and Jira. To avoid duplicate Jira issues on reload, the link is saved in Intercom as a tag named `jira-KEY` (for example `jira-TRX-123`) and read back on the next load. Use a sandbox Jira project first.

## Run locally

```bash
npm install
cp .env.example .env.local   # optional, leave blank for sample-data mode
npm run dev                  # http://localhost:3000
```

## Deploy to Vercel

1. Push this folder to a GitHub repo (files at the top level: `app/`, `lib/`, `package.json`, ...).
2. In Vercel: **Add New -> Project**, import the repo. Framework is auto-detected as Next.js; no build settings to change.
3. (Optional) add environment variables under **Settings -> Environment Variables**, then redeploy.

With no variables set, the deployed demo uses sample court-records tickets and simulated Jira keys. The badges in the top bar show which mode each side is in.

## Environment variables

| Variable | Needed for | Notes |
| --- | --- | --- |
| `INTERCOM_ACCESS_TOKEN` | Live Intercom | Must be able to read conversations, manage tags, and reply with notes |
| `INTERCOM_ADMIN_ID` | Live Intercom | Teammate the tags and notes are attributed to |
| `JIRA_BASE_URL` | Live Jira | e.g. `https://yourcompany.atlassian.net` |
| `JIRA_EMAIL` | Live Jira | Account that owns the API token |
| `JIRA_API_TOKEN` | Live Jira | Create at id.atlassian.com -> Security -> API tokens |
| `JIRA_PROJECT_KEY` | Live Jira | Project the demo issues land in (use a sandbox project) |
| `JIRA_BUG_ISSUE_TYPE` | Optional | Defaults to `Bug` |
| `JIRA_FEEDBACK_ISSUE_TYPE` | Optional | Defaults to `Task` |
| `DEMO_FORCE_MOCK` | Optional | `true` ignores all credentials and always uses sample data |

Credentials stay server-side in the API routes; nothing is exposed to the browser.

## Demo script

1. Open the app. Point out the mode badges (sample vs live).
2. Watch the inbox: each ticket gets its tag, then a Jira key, one after another (the activity log at the bottom shows every API call).
3. Click **"Transcript request stuck on 'Processing'"**. Highlighted words show why it was tagged `product_bug`; the Jira panel shows the issue.
4. Override: click the **x** on `product_bug`, then pick `product_feedback`. The tag changes in Intercom and the Jira issue is updated to match.
5. Click **"Question about SOC 2 report"**: no signal, so no tag and no Jira issue. Pick a tag manually to see the Jira issue get created.
6. Click **Reset demo** to run it all again.

## Tuning what gets tagged

Edit the two word lists at the top of `lib/keywords.ts`. `AUTO_TAG_MIN_MATCHES` (default 1) sets how many keyword hits are needed before auto-tagging. A trailing `*` matches word endings (`fail*` matches failed, failing, failure).

## Rebranding

Colors live in the first block of `app/globals.css` (HSL values, shadcn/ui format). Change `--primary`, `--brand` and friends there; the whole UI follows.

## How it works

```
Browser UI  ->  /api/tickets     ->  Intercom GET /conversations
            ->  /api/tag (POST)  ->  Intercom POST /tags, POST /conversations/{id}/tags
            ->  /api/tag (DELETE)->  Intercom DELETE /conversations/{id}/tags/{tag_id}
            ->  /api/jira (POST) ->  Jira POST /rest/api/3/issue
                                 ->  Intercom note + jira-KEY tag
            ->  /api/jira (PUT)  ->  Jira PUT /rest/api/3/issue/{key}
```

- `lib/intercom.ts`, `lib/jira.ts`: API clients, each with a sample-mode fallback.
- `lib/keywords.ts`: keyword lists, highlighting, tag suggestion (placeholder for an LLM or Intercom's own categorization). `lib/classify.ts` is an older version and is no longer used.
- `lib/mock.ts`: sample tickets. Replace the wording with real TRX product terminology before showing the team.
- `components/ui/*`: shadcn/ui-style components (Button, Badge, Card) built on Tailwind and class-variance-authority.
- Mapping lives in `lib/jira.ts` (`appConfig`): `product_bug` -> Bug, `product_feedback` -> Task, plus a `from-intercom` label.

## Known POC limits

- Sample-data mode keeps state in the browser only; refreshing re-runs the automation from scratch.
- Switching a tag on a ticket with an existing Jira issue also changes its issue type. Jira only allows that if the project's workflow permits it; if Jira refuses, the error is shown and the issue keeps its old type.
- Removing a tag does not delete the Jira issue; it stays linked.
- Uses Intercom **conversations**. If TRX uses Intercom **Tickets** (ticket types), the swap is `tickets/search` and `tickets/{id}/tags`.
- Auto-tagging runs on page load. Production would use an Intercom webhook (`conversation.created`) hitting a route like `/api/webhooks/intercom`.
- Customer names and organizations are copied into Jira descriptions. For a court-records vendor, decide what is acceptable to send (redaction, no case numbers) before using real data.
