import type { JiraLink, Tag, Ticket } from "./types";
import { TAGS, isEscalated, tagLabel } from "./types";
import { suggestTags } from "./keywords";
import { bestGroup, buildCorpus, RELATED_THRESHOLD, GROUP_THRESHOLD } from "./grouping";
import { buildDescription, buildLabels, buildSummary } from "./story";

// The brain of the demo, kept free of React and fetch so it can be tested.
// The UI gives it real API calls (see app/page.tsx); tests give it fakes.
//
// Rules:
//  * Tags are not exclusive: a ticket can be bug and feedback, with one Jira issue per tag.
//  * A new ticket joins the most similar existing issue with the same tag
//    (TF-IDF cosine >= GROUP_THRESHOLD), otherwise it opens a new issue.
//  * Every grouping decision can be overridden: move, split out, unlink, remove tag.
//  * Any manual override marks the ticket "reviewed"; automation never touches it again.

export interface Api {
  addTag(id: string, tag: Tag): Promise<void>;
  removeTag(id: string, tag: Tag): Promise<void>;
  createIssue(a: { tag: Tag; summary: string; description: string; seed: string; labels?: string[] }): Promise<{ key: string; url: string | null }>;
  updateIssue(a: { key: string; summary: string; description: string; comment?: string }): Promise<void>;
  comment(key: string, text: string): Promise<void>;
  link(id: string, key: string, tag: Tag, url: string | null): Promise<void>;
  unlink(id: string, key: string, tag: Tag): Promise<void>;
  markReviewed(id: string): Promise<void>;
  relate(a: string, b: string): Promise<void>;
}

export interface TriageEvent {
  kind: "tagged" | "related" | "created" | "joined" | "moved" | "split" | "unlinked" | "untagged" | "error";
  ticketId: string;
  message: string;
  key?: string;
  tag?: Tag;
}

export interface Issue {
  key: string;
  tag: Tag;
  url: string | null;
  members: Ticket[]; // oldest first
}

export interface GroupReason {
  score: number;
  shared: string[];
}

export class Triage {
  tickets: Ticket[];
  // Why a ticket was grouped with an issue: key = `${ticketId}|${issueKey}`. Session-only.
  reasons = new Map<string, GroupReason>();
  // "Relates to" links between Jira issues created this session.
  relations: { a: string; b: string; reason: string }[] = [];
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    tickets: Ticket[],
    private api: Api,
    private hooks: { onChange?: (t: Ticket[]) => void; onEvent?: (e: TriageEvent) => void } = {}
  ) {
    this.tickets = tickets.map((t) => ({ ...t, tags: [...t.tags], jira: [...t.jira] }));
  }

  // ---- helpers ------------------------------------------------------------
  private emit(e: TriageEvent) {
    this.hooks.onEvent?.(e);
  }
  private changed() {
    this.hooks.onChange?.(this.tickets.map((t) => ({ ...t, tags: [...t.tags], jira: [...t.jira] })));
  }
  private get(id: string): Ticket {
    const t = this.tickets.find((x) => x.id === id);
    if (!t) throw new Error(`Unknown ticket ${id}`);
    return t;
  }
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => undefined);
    return run;
  }

  issues(): Issue[] {
    const map = new Map<string, Issue>();
    for (const t of this.tickets) {
      for (const l of t.jira) {
        const id = `${l.tag}|${l.key}`;
        const cur = map.get(id) ?? { key: l.key, tag: l.tag, url: l.url, members: [] };
        cur.members.push(t);
        map.set(id, cur);
      }
    }
    const out = Array.from(map.values());
    for (const i of out) i.members.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return out;
  }

  private membersOf(key: string, tag: Tag): Ticket[] {
    return this.issues().find((i) => i.key === key && i.tag === tag)?.members ?? [];
  }

  private ensureTag(t: Ticket, tag: Tag) {
    if (!t.tags.includes(tag)) t.tags.push(tag);
  }

  private async attachLocal(t: Ticket, link: JiraLink) {
    await this.api.link(t.id, link.key, link.tag, link.url);
    t.jira.push(link);
    this.changed();
  }

  private async detachLocal(t: Ticket, key: string, tag: Tag) {
    await this.api.unlink(t.id, key, tag);
    t.jira = t.jira.filter((l) => !(l.key === key && l.tag === tag));
    this.reasons.delete(`${t.id}|${key}`);
    this.changed();
  }

  private async review(t: Ticket) {
    if (t.reviewed) return;
    await this.api.markReviewed(t.id);
    t.reviewed = true;
    this.changed();
  }

  // Rewrites a Jira issue from its current members (or notes that it is orphaned).
  private async refresh(key: string, tag: Tag, comment: string) {
    const members = this.membersOf(key, tag);
    if (members.length === 0) {
      await this.api.comment(key, `${comment} No Intercom conversations are linked to this issue anymore; close it if it is no longer needed.`);
      return;
    }
    await this.api.updateIssue({
      key,
      summary: buildSummary(tag, members),
      description: buildDescription(tag, members),
      comment,
    });
  }

  relatedTo(key: string): { key: string; reason: string }[] {
    return this.relations.filter((r) => r.a === key || r.b === key).map((r) => ({ key: r.a === key ? r.b : r.a, reason: r.reason }));
  }

  private async relate(a: string, b: string, reason: string) {
    if (a === b || this.relations.some((r) => (r.a === a && r.b === b) || (r.a === b && r.b === a))) return;
    await this.api.relate(a, b);
    this.relations.push({ a, b, reason });
    this.changed();
    this.emit({ kind: "related", ticketId: "", key: a, message: `${a} relates to ${b}: ${reason}` });
  }

  // After a ticket got an issue: connect it to its sibling issues (same conversation,
  // different tag) and, if it opened a new issue, to a near-miss issue it resembles.
  private async linkRelated(t: Ticket, link: JiraLink, opened: boolean) {
    for (const sib of t.jira) {
      if (sib.key !== link.key) await this.relate(link.key, sib.key, `same Intercom conversation (${tagLabel(sib.tag)} + ${tagLabel(link.tag)})`);
    }
    if (opened) {
      const candidates = this.issues().filter((i) => i.tag === link.tag && i.key !== link.key);
      const near = bestGroup(t, candidates.map((i) => ({ key: i.key, members: i.members })), buildCorpus(this.tickets), RELATED_THRESHOLD, GROUP_THRESHOLD);
      if (near) await this.relate(link.key, near.key, `similar wording (${Math.round(near.score * 100)}%: ${near.shared.join(", ")})`);
    }
  }

  private async createFor(t: Ticket, tag: Tag): Promise<Issue> {
    const issue = await this.api.createIssue({
      tag,
      summary: buildSummary(tag, [t]),
      description: buildDescription(tag, [t]),
      seed: t.id,
      labels: buildLabels([t]),
    });
    const link: JiraLink = { key: issue.key, tag, url: issue.url };
    await this.attachLocal(t, link);
    await this.linkRelated(t, link, true);
    return { key: issue.key, tag, url: issue.url, members: [t] };
  }

  // Join the most similar issue with this tag, or open a new one.
  private async assign(t: Ticket, tag: Tag): Promise<void> {
    this.ensureTag(t, tag);
    const candidates = this.issues().filter((i) => i.tag === tag && !t.jira.some((l) => l.key === i.key));
    const corpus = buildCorpus(this.tickets);
    const hit = bestGroup(
      t,
      candidates.map((i) => ({ key: i.key, members: i.members })),
      corpus
    );
    if (hit) {
      const issue = candidates.find((i) => i.key === hit.key)!;
      const joined: JiraLink = { key: issue.key, tag, url: issue.url };
      await this.attachLocal(t, joined);
      await this.linkRelated(t, joined, false);
      this.reasons.set(`${t.id}|${issue.key}`, { score: hit.score, shared: hit.shared });
      await this.refresh(issue.key, tag, `Intercom conversation ${t.id} was added to this issue (${t.customer.org || t.customer.name}).`);
      this.emit({
        kind: "joined",
        ticketId: t.id,
        key: issue.key,
        tag,
        message: `${t.id} joined ${issue.key} (${Math.round(hit.score * 100)}% similar: ${hit.shared.join(", ")})`,
      });
    } else {
      const created = await this.createFor(t, tag);
      this.emit({ kind: "created", ticketId: t.id, key: created.key, tag, message: `${t.id} opened ${created.key} (${tag})` });
    }
  }

  // ---- automatic pass -----------------------------------------------------
  auto(): Promise<void> {
    return this.serial(async () => {
      const order = [...this.tickets].sort((a, b) => a.createdAt.localeCompare(b.createdAt)); // oldest first: they lead groups
      for (const t of order) {
        if (t.reviewed) continue;
        const sug = suggestTags(t.subject, t.body);
        const existing = TAGS.filter((x) => t.tags.includes(x));
        const desired = TAGS.filter((x) => sug.tags.includes(x) || existing.includes(x));
        for (const tag of desired) {
          if (t.jira.some((l) => l.tag === tag)) continue;
          // General inquiries and billing issues are tagged but stay with support.
          const escalate = isEscalated(tag);
          if (!escalate && t.tags.includes(tag)) continue;
          try {
            if (!t.tags.includes(tag)) {
              await this.api.addTag(t.id, tag);
              this.ensureTag(t, tag);
              this.changed();
              this.emit({ kind: "tagged", ticketId: t.id, tag, message: `${t.id} tagged ${tag} (${sug.matched[tag].join(", ")})` });
            }
            if (escalate) await this.assign(t, tag);
          } catch (e) {
            this.emit({ kind: "error", ticketId: t.id, tag, message: e instanceof Error ? e.message : "Automation failed" });
          }
        }
      }
    });
  }

  // ---- overrides ----------------------------------------------------------
  // Add a tag by hand. The ticket is grouped automatically, then can be moved.
  addTag(id: string, tag: Tag): Promise<void> {
    return this.serial(async () => {
      const t = this.get(id);
      if (!t.tags.includes(tag)) await this.api.addTag(id, tag);
      this.ensureTag(t, tag);
      await this.review(t);
      this.changed();
      if (isEscalated(tag) && !t.jira.some((l) => l.tag === tag)) await this.assign(t, tag);
    });
  }

  // Remove a tag by hand: the ticket leaves that tag's issue(s) too.
  removeTag(id: string, tag: Tag): Promise<void> {
    return this.serial(async () => {
      const t = this.get(id);
      await this.api.removeTag(id, tag);
      t.tags = t.tags.filter((x) => x !== tag);
      await this.review(t);
      for (const l of t.jira.filter((x) => x.tag === tag)) {
        await this.detachLocal(t, l.key, tag);
        await this.refresh(l.key, tag, `Intercom conversation ${id} was removed (tag ${tag} was removed by support).`);
      }
      this.changed();
      this.emit({ kind: "untagged", ticketId: id, tag, message: `${id} no longer tagged ${tag}` });
    });
  }

  // "Wrong group": move this ticket into another existing issue with the same tag.
  moveTo(id: string, fromKey: string, toKey: string): Promise<void> {
    return this.serial(async () => {
      const t = this.get(id);
      const from = t.jira.find((l) => l.key === fromKey);
      const target = this.issues().find((i) => i.key === toKey);
      if (!from || !target || target.tag !== from.tag) throw new Error("Can only move into an issue with the same tag");
      if (t.jira.some((l) => l.key === toKey)) throw new Error("Already in that issue");
      await this.review(t);
      await this.detachLocal(t, fromKey, from.tag);
      await this.attachLocal(t, { key: toKey, tag: from.tag, url: target.url });
      await this.refresh(toKey, from.tag, `Intercom conversation ${id} was moved into this issue by support.`);
      await this.refresh(fromKey, from.tag, `Intercom conversation ${id} was moved out of this issue by support.`);
      this.emit({ kind: "moved", ticketId: id, key: toKey, tag: from.tag, message: `${id} moved ${fromKey} -> ${toKey}` });
    });
  }

  // "This is its own thing": take it out of the shared issue and open a new one just for it.
  splitOut(id: string, fromKey: string): Promise<void> {
    return this.serial(async () => {
      const t = this.get(id);
      const from = t.jira.find((l) => l.key === fromKey);
      if (!from) throw new Error("Ticket is not in that issue");
      await this.review(t);
      await this.detachLocal(t, fromKey, from.tag);
      const created = await this.createFor(t, from.tag);
      await this.refresh(fromKey, from.tag, `Intercom conversation ${id} was split out into ${created.key} by support.`);
      this.emit({ kind: "split", ticketId: id, key: created.key, tag: from.tag, message: `${id} split out of ${fromKey} into ${created.key}` });
    });
  }

  // Take it out of the issue and don't open a new one.
  unlink(id: string, fromKey: string): Promise<void> {
    return this.serial(async () => {
      const t = this.get(id);
      const from = t.jira.find((l) => l.key === fromKey);
      if (!from) throw new Error("Ticket is not in that issue");
      await this.review(t);
      await this.detachLocal(t, fromKey, from.tag);
      await this.refresh(fromKey, from.tag, `Intercom conversation ${id} was unlinked by support.`);
      this.emit({ kind: "unlinked", ticketId: id, key: fromKey, tag: from.tag, message: `${id} unlinked from ${fromKey}` });
    });
  }

  // Open a new issue for a tagged ticket that has none (after unlinking, or for a tag
  // that is not escalated automatically, such as a billing issue that needs engineering).
  createNew(id: string, tag: Tag): Promise<void> {
    return this.serial(async () => {
      const t = this.get(id);
      if (t.jira.some((l) => l.tag === tag)) throw new Error("Already linked for that tag");
      this.ensureTag(t, tag);
      await this.review(t);
      const created = await this.createFor(t, tag);
      this.emit({ kind: "created", ticketId: id, key: created.key, tag, message: `${id} opened ${created.key} (${tag})` });
    });
  }
}
