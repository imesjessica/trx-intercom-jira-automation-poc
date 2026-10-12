# Support to Engineering Handoff (POC)

Demo flow: **Intercom ticket -> tag (`product_bug` or `product_feedback`) -> Jira issue**, with the Jira key written back to Intercom as an internal note.

Built with Next.js (App Router). It runs fully on **sample data** with zero setup, and switches each side to **live** (Intercom, Jira) independently as soon as you add credentials.

## Run locally

```bash
npm install
cp .env.example .env.local   # optional, leave blank for sample-data mode
npm run dev                  # http://localhost:3000
```

## Deploy to Vercel

1. Push this folder to a GitHub repo.
2. In Vercel: **Add New -> Project**, import the repo. Framework is auto-detected as Next.js; no build settings to change.
3. (Optional) add environment variables under **Settings -> Environment Variables**, then redeploy.

With no variables set, the deployed demo uses sample court-records tickets and simulated Jira keys. The badges in the top bar show which mode each side is in.

## Environment variables

| Variable | Needed for | Notes |
| --- | --- | --- |
| `INTERCOM_ACCESS_TOKEN` | Live Intercom | Must be able to read conversations, manage tags, and reply with notes |
| `INTERCOM_ADMIN_ID` | Live Intercom | Teammate the tag and note are attributed to |
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
2. Click **"Transcript request stuck on 'Processing'"**. The tool suggests `product_bug` and shows which words triggered it.
3. Problem words are highlighted in red and request words in green. With "Auto-tag" on (the default for sample data), the tag is applied as soon as the ticket opens; otherwise click **product_bug**. Either way the tag is written to Intercom (see the activity log).
4. Review the Jira draft (project, issue type, labels, editable summary and description) and click **Create Jira issue**.
5. Show the result: Jira key, link, and the note added back to the Intercom conversation.
6. Repeat with **"Would love bulk download..."** to show `product_feedback` mapping to a different issue type.
7. Click **Reset demo** to run it again.

## How it works

```
Browser UI  ->  /api/tickets  ->  Intercom GET /conversations
            ->  /api/tag      ->  Intercom POST /tags, POST /conversations/{id}/tags
            ->  /api/jira     ->  Jira POST /rest/api/3/issue
                              ->  Intercom POST /conversations/{id}/reply (internal note)
```

- `lib/intercom.ts`, `lib/jira.ts`: API clients, each with a mock fallback.
- `lib/keywords.ts`: keyword lists, highlighting and auto-tag suggestion (placeholder for an LLM or Intercom's own categorization). Edit the lists at the top to tune what gets highlighted and tagged. `app/Highlighted.tsx` renders the highlights. `lib/classify.ts` is the older version and is no longer used.
- `lib/mock.ts`: sample tickets. Replace the wording with real TRX product terminology before showing the team.
- Mapping lives in `lib/jira.ts` (`appConfig`): `product_bug` -> Bug, `product_feedback` -> Task, plus `from-intercom` label.

## Known POC limits

- Sample-data mode keeps state in the browser only; refreshing resets it.
- Uses Intercom **conversations**. If TRX uses Intercom **Tickets** (ticket types), the swap is `tickets/search` and `tickets/{id}/tags`.
- The human clicks the tag. Moving to auto-tagging means an Intercom webhook (`conversation.created`) hitting a new `/api/webhooks/intercom` route.
- No dedupe yet: pushing the same ticket twice would create two Jira issues in live mode. Production should store the Intercom-to-Jira mapping.
- Customer names and organizations are copied into Jira descriptions. For a court-records vendor, decide what is acceptable to send (redaction, no case numbers) before using real data.
