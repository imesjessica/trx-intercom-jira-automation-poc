# Support to Engineering Handoff (POC)

Fully automatic flow: **Intercom ticket -> keyword scan -> tags (`product_bug`, `product_feedback`, or both) -> Jira issues**, with similar tickets grouped into the same Jira issue. Every automatic decision can be overridden in the UI.

Built with Next.js (App Router), Tailwind CSS and shadcn/ui-style components. It runs on **sample data** with zero setup, and switches each side to **live** (Intercom, Jira) independently as soon as you add credentials.

## What happens when the page loads

1. Tickets are fetched from Intercom (or the built-in sample tickets), including status (open / closed / snoozed) and whether a teammate has replied.
2. Problem words and request words are highlighted in each ticket.
3. Tags are **not exclusive**. A ticket with problem words gets `product_bug`; one with request words gets `product_feedback`; one with both gets both, and **one Jira issue per tag**.
4. For each tag, the ticket is compared (TF-IDF text similarity) with existing issues of the same tag. If one is similar enough (`GROUP_THRESHOLD` in `lib/grouping.ts`), the ticket **joins that issue**; otherwise a new issue is opened. Oldest tickets lead the group.
5. Joining updates the Jira issue (summary "+N similar", evidence list) and leaves a Jira comment.
6. The UI shows grouping everywhere: matching colored issue chips with "shared xN" in the list, a "Grouped with" panel and the similarity reason in the detail view, and a "Jira issues" tab listing every issue with its tickets.

## Jira description format

Every issue is written as a user story plus a mini PRD: User story, Problem statement, Evidence (each linked Intercom conversation with org, date, status, follow-up state), Requirements, Acceptance criteria, Success metrics, Open questions. It is **template-generated from the ticket text** (no AI); parts that need a human say TBD. Swapping the templates in `lib/story.ts` for an LLM call is the natural upgrade.

## Closed / followed up

Each ticket shows its Intercom status and whether a teammate has replied. Filters: All / Open / Closed / Snoozed and Any follow-up / Needs follow-up / Followed up. "Needs follow-up" means open with no teammate reply. Status and follow-up are also listed in each Jira issue's evidence section.

## Overrides (when the automation guesses wrong)

- **Tags:** click x to remove a tag (the ticket also leaves that tag's Jira issue); click a dashed tag to add it (it is grouped automatically).
- **Move to...:** put a ticket into a different existing issue with the same tag.
- **Split into its own issue:** take it out of a shared issue and open a new one.
- **Unlink:** take it out of the issue without opening a new one. **Create issue** opens one later.
- Any override marks the ticket "manually reviewed"; automation never touches it again.
- Both affected Jira issues are rewritten and get a comment, so engineers can see what happened.

**Live mode caution:** the automation runs on page load against the 15 most recent conversations and writes to the real Intercom and Jira. Links are stored in Intercom as tags named `jira-bug-KEY` / `jira-feedback-KEY` (for example `jira-bug-TRX-123`), and manual review as `triage-reviewed`. Use a sandbox Jira project first.

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

1. Open the app. Point out the mode badges and watch tickets get tagged and attached to Jira issues (the activity log shows every API call).
2. Open **"Transcript request stuck on 'Processing'"** and **"Transcript order stuck in Processing"**: same colored Jira chip, "shared x2", and a "Grouped with" panel explaining why.
3. Open **"Audio download times out ... (would love a bulk zip too)"**: it carries both tags and has two Jira issues, one joined to the bulk-download request.
4. Use the **Jira issues** tab, then the filters: show only Closed, or Open + Needs follow-up.
5. Override a grouping: on the stuck-transcript ticket click **Split into its own issue**, then **Move to...** to put it back.
6. Click **"Question about SOC 2 report"**: no signal, so no tag. Add a tag by hand to create an issue.
7. Click **Reset demo** to run it again.

## Tuning what gets tagged and grouped

Edit the two word lists at the top of `lib/keywords.ts`. `AUTO_TAG_MIN_MATCHES` (default 1) sets how many keyword hits are needed before auto-tagging. `GROUP_THRESHOLD` in `lib/grouping.ts` (default 0.25) controls how similar two tickets must be to share an issue; raise it for fewer merges. A trailing `*` matches word endings (`fail*` matches failed, failing, failure).

## Rebranding

Colors live in the first block of `app/globals.css` (HSL values, shadcn/ui format). Change `--primary`, `--brand` and friends there; the whole UI follows.

## How it works

```
Browser UI  ->  /api/tickets     ->  Intercom GET /conversations
            ->  /api/tag         ->  Intercom POST/DELETE /conversations/{id}/tags
            ->  /api/jira POST   ->  Jira POST /rest/api/3/issue
            ->  /api/jira PUT    ->  Jira PUT /rest/api/3/issue/{key} (+ comment)
            ->  /api/jira PATCH  ->  Jira POST /rest/api/3/issue/{key}/comment
            ->  /api/link        ->  Intercom note + jira-bug/feedback-KEY tag (POST link, DELETE unlink, PUT mark reviewed)
```

- `lib/pipeline.ts`: the tag / group / override logic (class `Triage`). No React or fetch inside; the page hands it real API calls.
- `lib/grouping.ts`: text similarity. `lib/story.ts`: user story + PRD text. `lib/keywords.ts`: keyword lists, highlighting, `suggestTags`.
- `lib/intercom.ts`, `lib/jira.ts`: API clients, each with a sample-mode fallback. `lib/mock.ts`: 10 sample court-records tickets. Replace the wording with real TRX terminology before showing the team.
- `components/ui/*`: shadcn/ui-style components. `lib/classify.ts` is an older unused version.
- Issue type mapping lives in `lib/jira.ts` (`appConfig`): `product_bug` -> Bug, `product_feedback` -> Task, plus a `from-intercom` label.

## Known POC limits

- Grouping is a text-similarity heuristic, not understanding. Expect some misses and false merges; that is what the overrides are for.
- Jira issues cannot be deleted from here. If an issue loses all its tickets, a comment is added suggesting it be closed.
- Moving tickets between issues rewrites the Jira description from the current members, so manual edits to those sections in Jira are overwritten.
- Sample-data mode keeps state in the browser only; refreshing re-runs the automation from scratch.
- `statistics.last_admin_reply_at` is used for "followed up"; confirm it is returned for your workspace.
- Uses Intercom **conversations**. If TRX uses Intercom **Tickets** (ticket types), the swap is `tickets/search` and `tickets/{id}/tags`.
- Auto-tagging runs on page load. Production would use an Intercom webhook (`conversation.created`) hitting a route like `/api/webhooks/intercom`.
- Customer names and organizations are copied into Jira descriptions. For a court-records vendor, decide what is acceptable to send (redaction, no case numbers) before using real data.
