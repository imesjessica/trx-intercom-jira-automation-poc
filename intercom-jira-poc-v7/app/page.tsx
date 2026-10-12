"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TAGS, isEscalated, tagLabel, type AppConfig, type JiraLink, type JiraStatus, type Tag, type Ticket, type TicketStatus, type Urgency } from "@/lib/types";
import { suggestTags } from "@/lib/keywords";
import { Triage, type Api, type GroupReason, type Issue } from "@/lib/pipeline";
import { assessUrgency } from "@/lib/urgency";
import { buildDescription, buildSummary, urgencyOf } from "@/lib/story";
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

const TAG_ORDER: Tag[] = ["product_bug", "product_feedback", "billing_issue", "general_inquiry"];
const TAG_TONE: Record<Tag, string> = {
  product_bug: "border-destructive/30 bg-destructive-soft text-destructive",
  product_feedback: "border-success/30 bg-success-soft text-success",
  billing_issue: "border-amber-300 bg-amber-100 text-amber-900",
  general_inquiry: "border-slate-300 bg-slate-100 text-slate-700",
};

const DONE: JiraStatus = { name: "Done", category: "done" };
const PROGRESS: JiraStatus = { name: "In Progress", category: "indeterminate" };
const TODO: JiraStatus = { name: "To Do", category: "new" };
const SIM_OPTIONS = [TODO, PROGRESS, DONE];

// Same look as Jira's own status lozenge: square corners, bold caps, gray / blue / green by status category.
const LOZENGE: Record<JiraStatus["category"], string> = {
  new: "bg-[#DFE1E6] text-[#42526E]",
  indeterminate: "bg-[#DEEBFF] text-[#0747A6]",
  done: "bg-[#E3FCEF] text-[#006644]",
};
function JiraLozenge({ status, className }: { status: JiraStatus; className?: string }) {
  return (
    <span className={cn("inline-block rounded-[3px] px-1.5 py-px text-[11px] font-bold uppercase leading-4 tracking-wide", LOZENGE[status.category], className)}>
      {status.name}
    </span>
  );
}

function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

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

// Open is neutral; "needs follow-up" is its own orange badge.
function FollowBadge({ t }: { t: Ticket }) {
  if (t.followedUp) {
    return (
      <Badge variant="muted" className="gap-1" title={t.lastAdminReplyAt ? `Last reply ${fmtDateTime(t.lastAdminReplyAt)}` : undefined}>
        <CheckIcon width={11} height={11} /> followed up
      </Badge>
    );
  }
  if (t.status === "open") return <Badge variant="followup">needs follow-up</Badge>;
  return <Badge variant="muted">no reply</Badge>;
}

function UrgencyBadge({ u }: { u: Urgency }) {
  if (u.churnRisk) return <Badge variant="urgent" title={u.reasons.join("; ")}>churn risk</Badge>;
  if (u.level === "high") return <Badge variant="urgent" title={u.reasons.join("; ")}>urgent</Badge>;
  if (u.level === "medium") return <Badge variant="urgent_medium" title={u.reasons.join("; ")}>elevated</Badge>;
  return null;
}

// A Jira issue chip: group color on the key, true Jira-colored status lozenge beside it.
// "shared x3" = 3 tickets in this issue.
function IssueChip({ link, shared, status }: { link: JiraLink; shared: number; status: JiraStatus }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border bg-card py-0.5 pl-0.5 pr-1.5 text-[11px] font-semibold">
      <span className={cn("rounded border px-1.5 py-px", colorFor(link.key))}>{link.key}</span>
      <JiraLozenge status={status} />
      {shared > 1 && <span className="text-[10.5px] font-medium text-muted-foreground">shared x{shared}</span>}
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
  if (applied) {
    return (
      <span className={cn("inline-flex items-center gap-1.5 rounded-full border py-1 pl-3 pr-1.5 text-[12.5px] font-semibold", TAG_TONE[tag])}>
        {tagLabel(tag)}
        <button
          type="button"
          disabled={busy}
          onClick={onRemove}
          aria-label={`Remove ${tagLabel(tag)}`}
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
      {tagLabel(tag)}
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
  const [urgentOnly, setUrgentOnly] = useState(false);
  const [noJiraOnly, setNoJiraOnly] = useState(false);
  const [sharedOnly, setSharedOnly] = useState(false);
  const [autoRunning, setAutoRunning] = useState(false);
  const [assessing, setAssessing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [events, setEvents] = useState<string[]>([]);
  const [moveTarget, setMoveTarget] = useState<Record<string, string>>({});
  const [jiraStatus, setJiraStatus] = useState<Record<string, JiraStatus>>({});
  const [simStatus, setSimStatus] = useState<Record<string, JiraStatus>>({}); // sample mode only
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
      relate: async (a, b) => void (await call("POST", "/api/relate", `Jira: link ${a} relates to ${b}`, { a, b })),
    }),
    [call]
  );

  const refreshStatuses = useCallback(
    async (keys: string[]) => {
      if (keys.length === 0) return;
      try {
        const d = await call("GET", `/api/jira?keys=${keys.join(",")}`, "Jira: read status");
        setJiraStatus((s) => ({ ...s, ...(d.statuses as Record<string, JiraStatus>) }));
      } catch {
        /* status is a nicety; ignore */
      }
    },
    [call]
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setLog([]);
    setEvents([]);
    setSimStatus({});
    try {
      const [cfg, tk] = await Promise.all([
        call("GET", "/api/config", "Load config"),
        call("GET", "/api/tickets", "Intercom: list conversations"),
      ]);
      setConfig(cfg);
      const list: Ticket[] = (tk.tickets as Ticket[]).map((t) => ({ ...t, urgency: assessUrgency(t.subject, t.body) }));
      setTickets(list);
      setSelectedId((cur) => cur ?? list[0]?.id ?? null);
      setLoading(false);

      // AI-assisted urgency (only when ANTHROPIC_API_KEY is set); keyword rules otherwise.
      if (cfg.ai) {
        setAssessing(true);
        let next = 0;
        const worker = async () => {
          while (next < list.length) {
            const t = list[next++];
            try {
              const d = await call("POST", "/api/urgency", `AI: urgency for ${t.id}`, { subject: t.subject, body: t.body });
              t.urgency = d.urgency as Urgency;
              setTickets([...list]);
            } catch {
              /* keep the keyword result */
            }
          }
        };
        await Promise.all([worker(), worker(), worker()]);
        setAssessing(false);
      }

      const tr = new Triage(list, api, {
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
      setAutoRunning(true);
      await tr.auto();
      await refreshStatuses(Array.from(new Set(tr.issues().map((i) => i.key))));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      setLoading(false);
    } finally {
      setAutoRunning(false);
      setAssessing(false);
    }
  }, [api, call, refreshStatuses]);

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
      await refreshStatuses(Array.from(new Set(tr.issues().map((i) => i.key))));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }

  const statusOf = (key: string): JiraStatus => simStatus[key] ?? jiraStatus[key] ?? TODO;

  const issues: Issue[] = useMemo(() => triage.current?.issues() ?? [], [tickets]); // eslint-disable-line react-hooks/exhaustive-deps
  const sharedCount = (key: string, tag: Tag) => issues.find((i) => i.key === key && i.tag === tag)?.members.length ?? 1;
  const isUrgent = (t: Ticket) => {
    const u = urgencyOf(t);
    return u.churnRisk || u.level === "high";
  };

  const visible = tickets.filter((t) => {
    if (statusFilter !== "all" && t.status !== statusFilter) return false;
    if (followFilter === "needs" && !(t.status === "open" && !t.followedUp)) return false;
    if (followFilter === "done" && !t.followedUp) return false;
    if (urgentOnly && !isUrgent(t)) return false;
    if (noJiraOnly && t.jira.length > 0) return false;
    return true;
  });
  const visibleIssues = issues.filter((i) => !sharedOnly || i.members.length > 1);

  const selected = tickets.find((t) => t.id === selectedId) ?? null;
  const sug = selected ? suggestTags(selected.subject, selected.body) : null;

  const noFilters = statusFilter === "all" && followFilter === "all" && !urgentOnly && !noJiraOnly;
  function resetFilters() {
    setStatusFilter("all");
    setFollowFilter("all");
    setUrgentOnly(false);
    setNoJiraOnly(false);
    setSharedOnly(false);
  }
  const tiles = [
    { id: "all", label: "Intercom tickets", n: tickets.length, active: view === "tickets" && noFilters, onClick: () => { resetFilters(); setView("tickets"); } },
    { id: "needs", label: "Open, needs follow-up", n: tickets.filter((t) => t.status === "open" && !t.followedUp).length, active: view === "tickets" && followFilter === "needs", onClick: () => { resetFilters(); setStatusFilter("open"); setFollowFilter("needs"); setView("tickets"); } },
    { id: "urgent", label: "Urgent / churn risk", n: tickets.filter(isUrgent).length, active: view === "tickets" && urgentOnly, onClick: () => { resetFilters(); setUrgentOnly(true); setView("tickets"); } },
    { id: "nojira", label: "Not sent to Jira", n: tickets.filter((t) => t.jira.length === 0).length, active: view === "tickets" && noJiraOnly, onClick: () => { resetFilters(); setNoJiraOnly(true); setView("tickets"); } },
    { id: "issues", label: "Jira issues", n: issues.length, active: view === "issues" && !sharedOnly, onClick: () => { resetFilters(); setView("issues"); } },
    { id: "shared", label: "Issues with 2+ tickets", n: issues.filter((i) => i.members.length > 1).length, active: view === "issues" && sharedOnly, onClick: () => { resetFilters(); setSharedOnly(true); setView("issues"); } },
  ];

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
            <ModeBadge name="Urgency" live={Boolean(config?.ai)} text={config ? (config.ai ? "AI" : "Keyword rules") : "..."} />
            <Button variant="outline" size="sm" onClick={() => void load()} disabled={autoRunning || busy}>
              <ResetIcon width={14} height={14} />
              {config?.intercom === "mock" ? "Reset demo" : "Reload"}
            </Button>
          </div>
        </div>
      </header>

      {/* Clickable stats = filters */}
      <div className="mx-auto grid max-w-7xl grid-cols-2 gap-3 px-4 pt-5 sm:grid-cols-3 sm:px-7 lg:grid-cols-6">
        {tiles.map((tile) => (
          <button
            key={tile.id}
            type="button"
            onClick={tile.onClick}
            aria-pressed={tile.active}
            className={cn(
              "rounded-lg border bg-card px-4 py-2.5 text-left shadow-sm transition hover:border-primary/50",
              tile.active && "border-primary ring-2 ring-primary/20"
            )}
          >
            <div className="text-xl font-semibold tabular-nums">{tile.n}</div>
            <div className="text-xs text-muted-foreground">{tile.label}</div>
          </button>
        ))}
      </div>

      {(autoRunning || assessing) && (
        <div className="mx-auto mt-3 max-w-7xl px-4 sm:px-7">
          <div className="flex items-center gap-2 text-[13px] text-primary">
            <Spinner /> {assessing ? "Assessing urgency with AI..." : "Tagging, grouping and creating Jira issues automatically..."}
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

      <main className="mx-auto grid max-w-7xl items-start gap-5 px-4 pb-12 pt-5 sm:px-7 lg:grid-cols-[420px_1fr]">
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
                    className={cn("rounded-md px-3 py-1 transition", view === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
                  >
                    {v === "tickets" ? "Intercom tickets" : "Jira issues"}
                  </button>
                ))}
              </div>
              <span className="text-xs text-muted-foreground">{view === "tickets" ? `${visible.length} shown` : `${visibleIssues.length} issues`}</span>
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
                const sugTags = suggestTags(t.subject, t.body).tags.filter(isEscalated);
                const pending = autoRunning && !t.reviewed && sugTags.some((tag) => !t.jira.some((l) => l.tag === tag));
                const u = urgencyOf(t);
                return (
                  <li key={t.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(t.id)}
                      className={cn("w-full px-4 py-3 text-left transition hover:bg-muted/60", selectedId === t.id && "bg-brand-soft")}
                    >
                      <div className="flex items-start justify-between gap-2 text-xs text-muted-foreground">
                        <span>
                          <b className="font-semibold text-foreground">{t.customer.name}</b>, {t.customer.org}
                        </span>
                        <span className="flex-none">{fmtDateTime(t.createdAt)}</span>
                      </div>
                      <div className="mt-1 flex items-start justify-between gap-2">
                        <span className="text-[13.5px] font-semibold leading-snug">{t.subject}</span>
                        {pending && <Spinner className="mt-0.5 flex-none text-primary" />}
                      </div>
                      <p className="mt-1 line-clamp-2 text-[12.5px] leading-snug text-muted-foreground">{t.body}</p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <UrgencyBadge u={u} />
                        <StatusBadge t={t} />
                        <FollowBadge t={t} />
                        {TAG_ORDER.filter((x) => t.tags.includes(x)).map((x) => (
                          <Badge key={x} variant={x}>
                            {tagLabel(x)}
                          </Badge>
                        ))}
                      </div>
                      {t.jira.length > 0 ? (
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          {t.jira.map((l) => (
                            <IssueChip key={l.key + l.tag} link={l} shared={sharedCount(l.key, l.tag)} status={statusOf(l.key)} />
                          ))}
                        </div>
                      ) : (
                        t.tags.some((x) => (TAGS as string[]).includes(x)) && (
                          <div className="mt-2 text-[11.5px] text-muted-foreground">No Jira issue (support handles this one)</div>
                        )
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <ul className="divide-y">
              {visibleIssues.length === 0 && <li className="p-6 text-sm text-muted-foreground">No Jira issues yet.</li>}
              {visibleIssues.map((i) => {
                const st = statusOf(i.key);
                return (
                  <li key={i.key + i.tag} className="px-4 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex flex-wrap items-center gap-2">
                        <IssueChip link={{ key: i.key, tag: i.tag, url: i.url }} shared={1} status={st} />
                        <Badge variant={i.tag}>{tagLabel(i.tag)}</Badge>
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
                            {m.customer.name}, {m.customer.org} ({fmtDateTime(m.createdAt)}): {m.subject}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </li>
                );
              })}
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
                  <UrgencyBadge u={urgencyOf(selected)} />
                  <StatusBadge t={selected} />
                  <FollowBadge t={selected} />
                  {selected.reviewed && <Badge variant="muted">manually reviewed</Badge>}
                </div>
                {selected.jira.length > 0 && (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span className="text-xs font-medium text-muted-foreground">Jira</span>
                    {selected.jira.map((l) => (
                      <IssueChip key={l.key + l.tag} link={l} shared={sharedCount(l.key, l.tag)} status={statusOf(l.key)} />
                    ))}
                  </div>
                )}
                <h2 className="mt-2 text-lg font-semibold leading-snug tracking-tight">
                  <Highlighted text={selected.subject} />
                </h2>
                <div className="mt-2 grid gap-x-6 gap-y-1 rounded-md bg-muted/50 px-3 py-2 text-[13px] sm:grid-cols-3">
                  <div>
                    <span className="text-muted-foreground">From </span>
                    <b>{selected.customer.name}</b>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Organization </span>
                    <b>{selected.customer.org || "unknown"}</b>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Received </span>
                    <b>{fmtDateTime(selected.createdAt)}</b> <span className="text-muted-foreground">({timeAgo(selected.createdAt)})</span>
                  </div>
                </div>
                <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <MessageIcon width={13} height={13} /> Intercom conversation #{selected.id}
                  {selected.intercomUrl && (
                    <a href={selected.intercomUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline">
                      Open in Intercom <ExternalLinkIcon width={11} height={11} />
                    </a>
                  )}
                </p>
                <p className="mt-2 whitespace-pre-line text-[14px] leading-relaxed">
                  <Highlighted text={selected.body} />
                </p>
                <div className="mt-3">
                  <HighlightLegend />
                </div>
              </div>

              {/* Urgency */}
              {(() => {
                const u = urgencyOf(selected);
                return (
                  <div
                    className={cn(
                      "rounded-lg border p-4",
                      u.churnRisk || u.level === "high" ? "border-destructive/40 bg-destructive-soft" : u.level === "medium" ? "border-orange-300 bg-orange-50" : "bg-muted/40"
                    )}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-sm font-semibold">
                        Customer urgency: <span className="uppercase">{u.level}</span>
                        {u.churnRisk && <span className="ml-2 text-destructive">Upset and may cancel</span>}
                      </div>
                      <span className="text-xs text-muted-foreground">{u.source === "ai" ? "Assessed by AI" : "Keyword rules"}</span>
                    </div>
                    {u.reasons.length > 0 ? (
                      <ul className="mt-1.5 list-disc pl-5 text-[12.5px]">
                        {u.reasons.map((r) => (
                          <li key={r}>{r}</li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-1 text-[12.5px] text-muted-foreground">No signs of an upset customer or time pressure.</p>
                    )}
                  </div>
                );
              })()}

              {/* Tags: not exclusive */}
              <div className="rounded-lg border p-4">
                <div className="text-sm font-semibold">Tags</div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  A ticket can carry several tags. Bug and feature request each get their own Jira issue; billing and general inquiry stay with support. Click x to remove, click a dashed tag to add.
                </p>
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
                const escalated = isEscalated(tag);
                return (
                  <Card key={tag} className="shadow-sm">
                    <CardHeader className="pb-3">
                      <CardTitle className="flex items-center gap-2 text-[15px]">
                        <Badge variant={tag}>{tagLabel(tag)}</Badge> Jira issue
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {links.length === 0 && (
                        <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                          {autoRunning && escalated ? (
                            <>
                              <Spinner /> Creating...
                            </>
                          ) : (
                            <>
                              {escalated ? "No Jira issue for this tag." : `${tagLabel(tag)} tickets stay with support, so no Jira issue is created automatically.`}
                              <Button size="sm" variant="outline" disabled={busy} onClick={() => void act((tr) => tr.createNew(selected.id, tag))}>
                                <ZapIcon width={13} height={13} /> {escalated ? "Create issue" : "Create Jira issue anyway"}
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
                        const st = statusOf(l.key);
                        const rel = triage.current?.relatedTo(l.key) ?? [];
                        return (
                          <div key={l.key} className={cn("space-y-3 rounded-lg border p-3.5", colorFor(l.key))}>
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-[15px] font-bold">{l.key}</span>
                                <span className="inline-flex items-center gap-1.5 text-xs font-medium">
                                  Jira status <JiraLozenge status={st} className="!text-[12px]" />
                                </span>
                                {l.url && (
                                  <a href={l.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-medium underline">
                                    Open in Jira <ExternalLinkIcon width={12} height={12} />
                                  </a>
                                )}
                              </div>
                              <span className="text-xs font-medium">{members.length === 1 ? "Only this ticket" : `Shared by ${members.length} tickets`}</span>
                            </div>
                            {config?.jira === "mock" && (
                              <label className="flex items-center gap-2 text-[11.5px] opacity-80">
                                Demo only: pretend Jira status is
                                <select
                                  value={st.name}
                                  onChange={(e) => setSimStatus((m) => ({ ...m, [l.key]: SIM_OPTIONS.find((o) => o.name === e.target.value) ?? TODO }))}
                                  className="h-7 rounded-md border border-input bg-card px-1.5 text-xs text-foreground"
                                >
                                  {SIM_OPTIONS.map((o) => (
                                    <option key={o.name}>{o.name}</option>
                                  ))}
                                </select>
                              </label>
                            )}
                            <div className="text-[13px] font-medium">{buildSummary(tag, members)}</div>

                            {others.length > 0 && (
                              <div className="rounded-md bg-white/70 p-2.5 text-[12.5px]">
                                <div className="font-semibold">Grouped with:</div>
                                <ul className="mt-1 space-y-0.5">
                                  {others.map((m) => (
                                    <li key={m.id}>
                                      <button type="button" onClick={() => setSelectedId(m.id)} className="text-left underline-offset-2 hover:underline">
                                        {m.customer.name}, {m.customer.org}: {m.subject}
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

                            {rel.length > 0 && (
                              <div className="rounded-md bg-white/70 p-2.5 text-[12.5px]">
                                <div className="font-semibold">Linked in Jira ("relates to"):</div>
                                <ul className="mt-1 space-y-0.5">
                                  {rel.map((r) => (
                                    <li key={r.key}>
                                      <b>{r.key}</b> <span className="opacity-80">({r.reason})</span>
                                    </li>
                                  ))}
                                </ul>
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
                              <summary className="cursor-pointer font-semibold">Jira description (user story + PRD + original Intercom ticket)</summary>
                              <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap rounded-md bg-white/80 p-3 font-sans text-[12.5px] leading-relaxed text-foreground">
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
                  {autoRunning ? "Checking for keywords..." : "No keyword signal found, so nothing was tagged and no Jira issue was created. Add a tag above to categorize it."}
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
                  {e.method} {e.path.split("?")[0]}
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
