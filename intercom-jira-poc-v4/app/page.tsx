"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TAGS, type AppConfig, type JiraLink, type Tag, type Ticket, type TicketStatus } from "@/lib/types";
import { suggestTags } from "@/lib/keywords";
import { Triage, type Api, type GroupReason, type Issue } from "@/lib/pipeline";
import { buildDescription, buildSummary } from "@/lib/story";
import { cn } from "@/lib/utils";
import { Highlighted, HighlightLegend } from "./Highlighted";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckIcon, ExternalLinkIcon, InboxIcon, MessageIcon, PlusIcon, ResetIcon, XIcon, ZapIcon } from "@/components/icons";

interface LogEntry {
  id: number;
  time: string;
  method: string;
  path: string;
  status: number;
  ms: number;
  note: string;
}

const TAG_ORDER: Tag[] = ["product_bug", "product_feedback"];
const TAG_LABEL: Record<Tag, string> = { product_bug: "product_bug", product_feedback: "product_feedback" };

// One colour per Jira issue so tickets sharing an issue are visibly the same group.
const GROUP_COLORS = [
  "border-sky-300 bg-sky-100 text-sky-900",
  "border-violet-300 bg-violet-100 text-violet-900",
  "border-amber-300 bg-amber-100 text-amber-900",
  "border-teal-300 bg-teal-100 text-teal-900",
  "border-pink-300 bg-pink-100 text-pink-900",
  "border-lime-300 bg-lime-100 text-lime-900",
];
function colorFor(key: string) {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return GROUP_COLORS[h % GROUP_COLORS.length];
}

function timeAgo(iso: string) {
  const mins = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

function Spinner({ className }: { className?: string }) {
  return <span className={cn("inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-r-transparent", className)} />;
}

function ModeBadge({ name, live, text }: { name: string; live: boolean; text: string }) {
  return (
    <Badge variant="outline" className="gap-1.5 bg-card py-1 font-normal text-muted-foreground shadow-sm">
      <span className={cn("h-1.5 w-1.5 rounded-full", live ? "bg-emerald-500 ring-4 ring-emerald-500/20" : "bg-brand")} />
      {name}: <b className="font-semibold text-foreground">{text}</b>
    </Badge>
  );
}

function StatusBadge({ t }: { t: Ticket }) {
  const v = t.status === "closed" ? "status_closed" : t.status === "snoozed" ? "status_snoozed" : "status_open";
  return <Badge variant={v}>{t.status}</Badge>;
}

function FollowBadge({ t }: { t: Ticket }) {
  if (t.followedUp) {
    return (
      <Badge variant="muted" className="gap-1" title={t.lastAdminReplyAt ? `Last reply ${timeAgo(t.lastAdminReplyAt)}` : undefined}>
        <CheckIcon width={11} height={11} /> followed up
      </Badge>
    );
  }
  if (t.status === "open") return <Badge variant="status_open">needs follow-up</Badge>;
  return <Badge variant="muted">no reply</Badge>;
}

// A Jira issue chip, coloured per issue. "x3" shows how many tickets share it.
function IssueChip({ link, shared }: { link: JiraLink; shared: number }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold", colorFor(link.key))}>
      {link.key}
      {shared > 1 && <span className="rounded-full bg-white/70 px-1 text-[10px]">shared x{shared}</span>}
    </span>
  );
}

function TagToggle({
  tag,
  applied,
  suggested,
  busy,
  onAdd,
  onRemove,
}: {
  tag: Tag;
  applied: boolean;
  suggested: boolean;
  busy: boolean;
  onAdd: () => void;
  onRemove: () => void;
}) {
  const tone = tag === "product_bug" ? "border-destructive/30 bg-destructive-soft text-destructive" : "border-success/30 bg-success-soft text-success";
  if (applied) {
    return (
      <span className={cn("inline-flex items-center gap-1.5 rounded-full border py-1 pl-3 pr-1.5 text-[12.5px] font-semibold", tone)}>
        {TAG_LABEL[tag]}
        <button
          type="button"
          disabled={busy}
          onClick={onRemove}
          aria-label={`Remove ${tag}`}
          title="Remove this tag (also leaves its Jira issue)"
          className="rounded-full p-0.5 hover:bg-black/10 disabled:opacity-50"
        >
          <XIcon width={13} height={13} />
        </button>
      </span>
    );
  }
  return (
    <button
      type="button"
      disabled={busy}
      onClick={onAdd}
      className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-input px-3 py-1 text-[12.5px] font-medium text-muted-foreground transition hover:border-primary hover:text-primary disabled:opacity-50"
    >
      <PlusIcon width={13} height={13} />
      {TAG_LABEL[tag]}
      {suggested && <span className="text-[10.5px] font-semibold uppercase text-brand">suggested</span>}
    </button>
  );
}

type StatusFilter = "all" | TicketStatus;
type FollowFilter = "all" | "needs" | "done";

export default function Page() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<"tickets" | "issues">("tickets");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [followFilter, setFollowFilter] = useState<FollowFilter>("all");
  const [autoRunning, setAutoRunning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [events, setEvents] = useState<string[]>([]);
  const [moveTarget, setMoveTarget] = useState<Record<string, string>>({});
  const triage = useRef<Triage | null>(null);
  const logId = useRef(0);

  const call = useCallback(async (method: string, path: string, note: string, body?: unknown) => {
    const t0 = performance.now();
    const res = await fetch(path, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
    });
    const data = await res.json().catch(() => ({}));
    setLog((l) => [
      ...l,
      { id: ++logId.current, time: new Date().toLocaleTimeString(), method, path, status: res.status, ms: Math.round(performance.now() - t0), note },
    ]);
    if (!res.ok) throw new Error(data.error || `${method} ${path} failed (${res.status})`);
    return data;
  }, []);

  const api: Api = useMemo(
    () => ({
      addTag: async (id, tag) => void (await call("POST", "/api/tag", `Intercom: tag ${id} ${tag}`, { id, tag })),
      removeTag: async (id, tag) => void (await call("DELETE", "/api/tag", `Intercom: untag ${id} ${tag}`, { id, tag })),
      createIssue: async (a) => (await call("POST", "/api/jira", `Jira: create (${a.tag})`, a)).issue,
      updateIssue: async (a) => void (await call("PUT", "/api/jira", `Jira: update ${a.key}`, a)),
      comment: async (key, text) => void (await call("PATCH", "/api/jira", `Jira: comment on ${key}`, { key, comment: text })),
      link: async (id, key, tag, url) => void (await call("POST", "/api/link", `Intercom: link ${id} to ${key}`, { id, key, tag, url })),
      unlink: async (id, key, tag) => void (await call("DELETE", "/api/link", `Intercom: unlink ${id} from ${key}`, { id, key, tag })),
      markReviewed: async (id) => void (await call("PUT", "/api/link", `Intercom: mark ${id} reviewed`, { id })),
    }),
    [call]
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setLog([]);
    setEvents([]);
    try {
      const [cfg, tk] = await Promise.all([
        call("GET", "/api/config", "Load config"),
        call("GET", "/api/tickets", "Intercom: list conversations"),
      ]);
      setConfig(cfg);
      const tr = new Triage(tk.tickets as Ticket[], api, {
        onChange: (t) => {
          if (triage.current === tr) setTickets(t);
        },
        onEvent: (e) => {
          if (triage.current !== tr) return;
          setEvents((ev) => [...ev, e.message]);
          if (e.kind === "error") setError(e.message);
        },
      });
      triage.current = tr;
      setTickets(tr.tickets);
      setSelectedId((cur) => cur ?? tr.tickets[0]?.id ?? null);
      setLoading(false);
      setAutoRunning(true);
      await tr.auto();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      setLoading(false);
    } finally {
      setAutoRunning(false);
    }
  }, [api, call]);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(fn: (tr: Triage) => Promise<void>) {
    const tr = triage.current;
    if (!tr) return;
    setBusy(true);
    setError(null);
    try {
      await fn(tr);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }

  const issues: Issue[] = useMemo(() => triage.current?.issues() ?? [], [tickets]); // eslint-disable-line react-hooks/exhaustive-deps
  const sharedCount = (key: string, tag: Tag) => issues.find((i) => i.key === key && i.tag === tag)?.members.length ?? 1;

  const visible = tickets.filter((t) => {
    if (statusFilter !== "all" && t.status !== statusFilter) return false;
    if (followFilter === "needs" && !(t.status === "open" && !t.followedUp)) return false;
    if (followFilter === "done" && !t.followedUp) return false;
    return true;
  });

  const selected = tickets.find((t) => t.id === selectedId) ?? null;
  const sug = selected ? suggestTags(selected.subject, selected.body) : null;
  const stats = {
    tickets: tickets.length,
    issues: issues.length,
    grouped: issues.filter((i) => i.members.length > 1).length,
    needs: tickets.filter((t) => t.status === "open" && !t.followedUp).length,
  };

  function reasonFor(t: Ticket, key: string): GroupReason | undefined {
    return triage.current?.reasons.get(`${t.id}|${key}`);
  }

  return (
    <>
      <header className="sticky top-0 z-20 border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-7">
          <div className="flex items-center gap-3">
            <div className="h-7 w-2.5 rounded-sm bg-gradient-to-b from-primary to-brand" />
            <div>
              <h1 className="text-[17px] font-semibold leading-tight tracking-tight">Support to Engineering Handoff</h1>
              <p className="text-xs text-muted-foreground">Proof of concept: Intercom ticket, tags, grouped Jira issues</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <ModeBadge name="Intercom" live={config?.intercom === "live"} text={config ? (config.intercom === "live" ? "Live" : "Sample data") : "..."} />
            <ModeBadge name="Jira" live={config?.jira === "live"} text={config ? (config.jira === "live" ? "Live" : "Simulated") : "..."} />
            <Button variant="outline" size="sm" onClick={() => void load()} disabled={autoRunning || busy}>
              <ResetIcon width={14} height={14} />
              {config?.intercom === "mock" ? "Reset demo" : "Reload"}
            </Button>
          </div>
        </div>
      </header>

      {/* Summary strip */}
      <div className="mx-auto grid max-w-7xl grid-cols-2 gap-3 px-4 pt-5 sm:grid-cols-4 sm:px-7">
        {[
          ["Intercom tickets", stats.tickets],
          ["Jira issues", stats.issues],
          ["Issues with 2+ tickets", stats.grouped],
          ["Open, awaiting follow-up", stats.needs],
        ].map(([label, n]) => (
          <div key={label as string} className="rounded-lg border bg-card px-4 py-2.5 shadow-sm">
            <div className="text-xl font-semibold tabular-nums">{n}</div>
            <div className="text-xs text-muted-foreground">{label}</div>
          </div>
        ))}
      </div>

      {autoRunning && (
        <div className="mx-auto mt-3 max-w-7xl px-4 sm:px-7">
          <div className="flex items-center gap-2 text-[13px] text-primary">
            <Spinner /> Tagging, grouping and creating Jira issues automatically...
          </div>
        </div>
      )}
      {error && (
        <div className="mx-auto mt-3 max-w-7xl px-4 sm:px-7">
          <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive-soft px-4 py-2.5 text-[13px] text-destructive">
            {error}
          </div>
        </div>
      )}

      <main className="mx-auto grid max-w-7xl items-start gap-5 px-4 pb-12 pt-5 sm:px-7 lg:grid-cols-[400px_1fr]">
        {/* Left: tickets / issues */}
        <Card className="overflow-hidden">
          <CardHeader className="space-y-3 border-b bg-muted/50 px-4 py-3">
            <div className="flex items-center justify-between">
              <div className="inline-flex rounded-lg border bg-card p-0.5 text-[12.5px] font-medium">
                {(["tickets", "issues"] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setView(v)}
                    className={cn("rounded-md px-3 py-1 capitalize transition", view === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
                  >
                    {v === "tickets" ? "Intercom tickets" : "Jira issues"}
                  </button>
                ))}
              </div>
              <span className="text-xs text-muted-foreground">{view === "tickets" ? `${visible.length} shown` : `${issues.length} issues`}</span>
            </div>
            {view === "tickets" && (
              <div className="flex flex-wrap gap-1.5 text-[12px]">
                {(["all", "open", "closed", "snoozed"] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setStatusFilter(s)}
                    className={cn("rounded-full border px-2.5 py-0.5 capitalize", statusFilter === s ? "border-primary bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:text-foreground")}
                  >
                    {s}
                  </button>
                ))}
                <span className="mx-1 w-px bg-border" />
                {(
                  [
                    ["all", "Any follow-up"],
                    ["needs", "Needs follow-up"],
                    ["done", "Followed up"],
                  ] as const
                ).map(([k, label]) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setFollowFilter(k)}
                    className={cn("rounded-full border px-2.5 py-0.5", followFilter === k ? "border-primary bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:text-foreground")}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
          </CardHeader>

          {loading ? (
            <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
              <Spinner /> Loading conversations...
            </div>
          ) : view === "tickets" ? (
            <ul className="divide-y">
              {visible.length === 0 && <li className="p-6 text-sm text-muted-foreground">No tickets match these filters.</li>}
              {visible.map((t) => {
                const pending =
                  autoRunning && !t.reviewed && suggestTags(t.subject, t.body).tags.some((tag) => !t.jira.some((l) => l.tag === tag));
                return (
                  <li key={t.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(t.id)}
                      className={cn("w-full px-4 py-3 text-left transition hover:bg-muted/60", selectedId === t.id && "bg-brand-soft")}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-[13.5px] font-semibold leading-snug">{t.subject}</span>
                        {pending && <Spinner className="mt-0.5 flex-none text-primary" />}
                      </div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {t.customer.org} · {timeAgo(t.createdAt)}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <StatusBadge t={t} />
                        <FollowBadge t={t} />
                        {TAG_ORDER.filter((x) => t.tags.includes(x)).map((x) => (
                          <Badge key={x} variant={x}>
                            {x}
                          </Badge>
                        ))}
                      </div>
                      {t.jira.length > 0 && (
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          {t.jira.map((l) => (
                            <IssueChip key={l.key + l.tag} link={l} shared={sharedCount(l.key, l.tag)} />
                          ))}
                        </div>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <ul className="divide-y">
              {issues.length === 0 && <li className="p-6 text-sm text-muted-foreground">No Jira issues yet.</li>}
              {issues.map((i) => (
                <li key={i.key + i.tag} className="px-4 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2">
                      <IssueChip link={{ key: i.key, tag: i.tag, url: i.url }} shared={1} />
                      <Badge variant={i.tag}>{i.tag}</Badge>
                    </span>
                    <span className="text-xs text-muted-foreground">{i.members.length} ticket{i.members.length === 1 ? "" : "s"}</span>
                  </div>
                  <div className="mt-1.5 text-[13px] font-medium">{buildSummary(i.tag, i.members)}</div>
                  <ul className="mt-1.5 space-y-0.5">
                    {i.members.map((m) => (
                      <li key={m.id}>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedId(m.id);
                            setView("tickets");
                          }}
                          className="text-left text-xs text-muted-foreground hover:text-primary"
                        >
                          {m.customer.org}: {m.subject}
                        </button>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Right: detail */}
        <Card>
          <CardHeader className="space-y-0 border-b bg-muted/50 px-5 py-3">
            <CardTitle className="text-[11.5px] font-semibold uppercase tracking-wider text-muted-foreground">Ticket detail</CardTitle>
          </CardHeader>
          {!selected || !sug ? (
            <CardContent className="flex flex-col items-center gap-2 p-10 text-center text-sm text-muted-foreground">
              <InboxIcon width={28} height={28} />
              Select a ticket.
            </CardContent>
          ) : (
            <CardContent className="space-y-5 p-5 sm:p-6">
              <div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <StatusBadge t={selected} />
                  <FollowBadge t={selected} />
                  {selected.reviewed && <Badge variant="muted">manually reviewed</Badge>}
                </div>
                <h2 className="mt-2 text-lg font-semibold leading-snug tracking-tight">
                  <Highlighted text={selected.subject} />
                </h2>
                <p className="mt-1 flex items-center gap-1.5 text-[13px] text-muted-foreground">
                  <MessageIcon width={13} height={13} />
                  {selected.customer.name}, {selected.customer.org} · {timeAgo(selected.createdAt)} · #{selected.id}
                </p>
                <p className="mt-3 whitespace-pre-line text-[14px] leading-relaxed">
                  <Highlighted text={selected.body} />
                </p>
                <div className="mt-3">
                  <HighlightLegend />
                </div>
              </div>

              {/* Tags: not exclusive */}
              <div className="rounded-lg border p-4">
                <div className="text-sm font-semibold">Tags</div>
                <p className="mt-0.5 text-xs text-muted-foreground">A ticket can carry both tags. Each tag gets its own Jira issue. Click x to remove, click a dashed tag to add.</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {TAG_ORDER.map((tag) => (
                    <TagToggle
                      key={tag}
                      tag={tag}
                      applied={selected.tags.includes(tag)}
                      suggested={sug.tags.includes(tag)}
                      busy={busy || autoRunning}
                      onAdd={() => void act((tr) => tr.addTag(selected.id, tag))}
                      onRemove={() => void act((tr) => tr.removeTag(selected.id, tag))}
                    />
                  ))}
                </div>
              </div>

              {/* One card per tag */}
              {TAG_ORDER.filter((tag) => selected.tags.includes(tag)).map((tag) => {
                const links = selected.jira.filter((l) => l.tag === tag);
                return (
                  <Card key={tag} className="shadow-sm">
                    <CardHeader className="pb-3">
                      <CardTitle className="flex items-center gap-2 text-[15px]">
                        <Badge variant={tag}>{tag}</Badge> Jira issue
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {links.length === 0 && (
                        <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                          {autoRunning ? (
                            <>
                              <Spinner /> Creating...
                            </>
                          ) : (
                            <>
                              No Jira issue for this tag.
                              <Button size="sm" variant="outline" disabled={busy} onClick={() => void act((tr) => tr.createNew(selected.id, tag))}>
                                <ZapIcon width={13} height={13} /> Create issue
                              </Button>
                            </>
                          )}
                        </div>
                      )}
                      {links.map((l) => {
                        const issue = issues.find((i) => i.key === l.key && i.tag === tag);
                        const members = issue?.members ?? [selected];
                        const others = members.filter((m) => m.id !== selected.id);
                        const why = reasonFor(selected, l.key);
                        const targets = issues.filter((i) => i.tag === tag && i.key !== l.key && !selected.jira.some((x) => x.key === i.key));
                        const mt = moveTarget[l.key + tag] ?? "";
                        return (
                          <div key={l.key} className={cn("space-y-3 rounded-lg border p-3.5", colorFor(l.key))}>
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="flex items-center gap-2">
                                <span className="text-[15px] font-bold">{l.key}</span>
                                {l.url && (
                                  <a href={l.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-medium underline">
                                    Open in Jira <ExternalLinkIcon width={12} height={12} />
                                  </a>
                                )}
                              </div>
                              <span className="text-xs font-medium">{members.length === 1 ? "Only this ticket" : `Shared by ${members.length} tickets`}</span>
                            </div>
                            <div className="text-[13px] font-medium">{buildSummary(tag, members)}</div>

                            {others.length > 0 && (
                              <div className="rounded-md bg-white/70 p-2.5 text-[12.5px]">
                                <div className="font-semibold">Grouped with:</div>
                                <ul className="mt-1 space-y-0.5">
                                  {others.map((m) => (
                                    <li key={m.id}>
                                      <button type="button" onClick={() => setSelectedId(m.id)} className="text-left underline-offset-2 hover:underline">
                                        {m.customer.org}: {m.subject}
                                      </button>
                                      <span className="ml-1.5 text-[11px] opacity-70">({m.status}{m.followedUp ? ", followed up" : ""})</span>
                                    </li>
                                  ))}
                                </ul>
                                {why && (
                                  <div className="mt-1.5 opacity-80">
                                    Why: {Math.round(why.score * 100)}% text similarity. Shared words: {why.shared.join(", ")}.
                                  </div>
                                )}
                              </div>
                            )}

                            {/* Override controls */}
                            <div className="flex flex-wrap items-center gap-2 border-t border-black/10 pt-3">
                              <span className="text-xs font-semibold">Wrong group?</span>
                              {targets.length > 0 && (
                                <>
                                  <select
                                    value={mt}
                                    onChange={(e) => setMoveTarget((m) => ({ ...m, [l.key + tag]: e.target.value }))}
                                    className="h-8 max-w-[220px] rounded-md border border-input bg-card px-2 text-xs text-foreground"
                                    aria-label="Move to another issue"
                                  >
                                    <option value="">Move to...</option>
                                    {targets.map((i) => (
                                      <option key={i.key} value={i.key}>
                                        {i.key}: {buildSummary(i.tag, i.members).slice(0, 40)}
                                      </option>
                                    ))}
                                  </select>
                                  <Button size="sm" variant="outline" className="bg-card" disabled={!mt || busy} onClick={() => void act((tr) => tr.moveTo(selected.id, l.key, mt))}>
                                    Move
                                  </Button>
                                </>
                              )}
                              {members.length > 1 && (
                                <Button size="sm" variant="outline" className="bg-card" disabled={busy} onClick={() => void act((tr) => tr.splitOut(selected.id, l.key))}>
                                  Split into its own issue
                                </Button>
                              )}
                              <Button size="sm" variant="outline" className="bg-card" disabled={busy} onClick={() => void act((tr) => tr.unlink(selected.id, l.key))}>
                                Unlink
                              </Button>
                            </div>

                            <details className="text-[12.5px]">
                              <summary className="cursor-pointer font-semibold">Jira description (user story + PRD)</summary>
                              <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded-md bg-white/80 p-3 font-sans text-[12.5px] leading-relaxed text-foreground">
                                {buildDescription(tag, members)}
                              </pre>
                            </details>
                          </div>
                        );
                      })}
                    </CardContent>
                  </Card>
                );
              })}

              {selected.tags.filter((x) => (TAGS as string[]).includes(x)).length === 0 && (
                <p className="text-sm text-muted-foreground">
                  {autoRunning ? "Checking for keywords..." : "No keyword signal found, so nothing was tagged and no Jira issue was created. Add a tag above to create one by hand."}
                </p>
              )}
            </CardContent>
          )}
        </Card>

        {/* Activity log */}
        <Card className="overflow-hidden border-slate-900 bg-slate-950 text-slate-200 lg:col-span-2">
          <CardHeader className="flex-row items-center justify-between space-y-0 border-b border-slate-800 bg-slate-900 px-4 py-3">
            <CardTitle className="text-[11.5px] font-semibold uppercase tracking-wider text-slate-400">Activity log (API calls)</CardTitle>
            <span className="text-xs text-slate-500">{log.length} calls</span>
          </CardHeader>
          <div className="max-h-64 overflow-auto p-4 font-mono text-xs leading-relaxed">
            {log.length === 0 && <span className="text-slate-500">Nothing yet.</span>}
            {log.map((e) => (
              <div key={e.id} className="flex flex-wrap gap-x-3">
                <span className="text-slate-500">{e.time}</span>
                <span className={e.status < 400 ? "text-emerald-400" : "text-red-400"}>{e.status}</span>
                <span className="text-sky-300">
                  {e.method} {e.path}
                </span>
                <span className="text-slate-400">{e.note}</span>
                <span className="text-slate-600">{e.ms}ms</span>
              </div>
            ))}
            {events.length > 0 && (
              <div className="mt-3 border-t border-slate-800 pt-2 text-amber-200/90">
                {events.map((m, i) => (
                  <div key={i}>{m}</div>
                ))}
              </div>
            )}
          </div>
        </Card>
      </main>
    </>
  );
}
