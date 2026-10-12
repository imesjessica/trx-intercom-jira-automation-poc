"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TAGS, type AppConfig, type Tag, type Ticket } from "@/lib/types";
import { suggestTag, AUTO_TAG_MIN_MATCHES } from "@/lib/keywords";
import { cn } from "@/lib/utils";
import { Highlighted, HighlightLegend } from "./Highlighted";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AlertIcon,
  CheckIcon,
  ExternalLinkIcon,
  InboxIcon,
  MessageIcon,
  PlusIcon,
  ResetIcon,
  XIcon,
} from "@/components/icons";

interface LogEntry {
  id: number;
  time: string;
  method: string;
  path: string;
  status: number;
  ms: number;
  note: string;
}

type Working = "tag" | "jira";

const STEPS = ["Inbox", "Tag", "Push to Jira", "Done"];
const TAG_ORDER: Tag[] = ["product_bug", "product_feedback"];

const isProductTag = (t: string): t is Tag => (TAGS as string[]).includes(t);
const productTagOf = (t: Ticket): Tag | undefined => t.tags.find(isProductTag);

function timeAgo(iso: string) {
  const mins = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

function defaultSummary(t: Ticket, tag: Tag) {
  return `[${tag === "product_bug" ? "Bug" : "Feedback"}] ${t.subject}`;
}

function defaultDescription(t: Ticket, tag: Tag) {
  return (
    `Reported via Intercom (conversation ${t.id}) by ${t.customer.name}, ${t.customer.org}.\n\n` +
    `${t.body}\n\n` +
    `Tagged ${tag} by support. Created from the Intercom to Jira handoff POC.`
  );
}

function Spinner({ className }: { className?: string }) {
  return (
    <span className={cn("inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-r-transparent", className)} />
  );
}

function ModeBadge({ name, live, text }: { name: string; live: boolean; text: string }) {
  return (
    <Badge variant="outline" className="gap-1.5 bg-card py-1 font-normal text-muted-foreground shadow-sm">
      <span className={cn("h-1.5 w-1.5 rounded-full", live ? "bg-emerald-500 ring-4 ring-emerald-500/20" : "bg-brand")} />
      {name}: <b className="font-semibold text-foreground">{text}</b>
    </Badge>
  );
}

// One of the two tags. Applied: filled, with an x to remove it.
// Not applied: click to add (or to switch, if the other tag is currently applied).
function TagChoice({
  tag,
  applied,
  suggested,
  disabled,
  onAdd,
  onRemove,
}: {
  tag: Tag;
  applied: boolean;
  suggested: boolean;
  disabled: boolean;
  onAdd: () => void;
  onRemove: () => void;
}) {
  const isBug = tag === "product_bug";
  const body = (
    <>
      <span className={cn("mt-0.5", isBug ? "text-destructive" : "text-success")}>
        {isBug ? <AlertIcon /> : <MessageIcon />}
      </span>
      <span>
        <span className="block text-sm font-semibold">{tag}</span>
        <span className="block text-[12.5px] text-muted-foreground">
          {isBug ? "Something is broken or behaving wrongly" : "Feature request or improvement idea"}
        </span>
      </span>
    </>
  );

  if (applied) {
    return (
      <div
        className={cn(
          "relative flex min-w-[200px] flex-1 items-start gap-3 rounded-lg border-2 p-4 pr-11 shadow-sm",
          isBug ? "border-destructive bg-destructive-soft" : "border-success bg-success-soft"
        )}
      >
        {body}
        <button
          type="button"
          onClick={onRemove}
          disabled={disabled}
          aria-label={`Remove tag ${tag}`}
          title="Remove tag"
          className="absolute right-2.5 top-2.5 rounded-full p-1 text-muted-foreground transition-colors hover:bg-background/80 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
        >
          <XIcon width={14} height={14} />
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onAdd}
      disabled={disabled}
      title={`Tag as ${tag}`}
      className={cn(
        "relative flex min-w-[200px] flex-1 items-start gap-3 rounded-lg border border-dashed border-input bg-card p-4 pr-16 text-left transition",
        "hover:-translate-y-px hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        "disabled:pointer-events-none disabled:opacity-50",
        isBug ? "hover:border-destructive hover:bg-destructive-soft" : "hover:border-success hover:bg-success-soft"
      )}
    >
      {body}
      <span className="absolute right-3 top-2.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
        {suggested && <span className={isBug ? "text-destructive" : "text-success"}>Suggested</span>}
        <PlusIcon width={13} height={13} />
      </span>
    </button>
  );
}

export default function Page() {
  const [tickets, setTickets] = useState<Ticket[] | null>(null);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [working, setWorking] = useState<Record<string, Working>>({});
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const runId = useRef(0); // lets a newer load cancel an older auto-run

  const addLog = useCallback((e: Omit<LogEntry, "id" | "time">) => {
    setLog((prev) => [{ ...e, id: Date.now() + Math.random(), time: new Date().toLocaleTimeString() }, ...prev]);
  }, []);

  const call = useCallback(
    async <T,>(method: "GET" | "POST" | "PUT" | "DELETE", path: string, note: string, body?: unknown): Promise<T> => {
      const start = performance.now();
      let status = 0;
      try {
        const res = await fetch(path, {
          method,
          headers: { "Content-Type": "application/json" },
          body: body ? JSON.stringify(body) : undefined,
        });
        status = res.status;
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
        return json as T;
      } finally {
        addLog({ method, path, status, ms: Math.round(performance.now() - start), note });
      }
    },
    [addLog]
  );

  const patchTicket = useCallback((id: string, patch: Partial<Ticket>) => {
    setTickets((prev) => prev?.map((t) => (t.id === id ? { ...t, ...patch } : t)) ?? prev);
  }, []);

  const mark = useCallback((id: string, kind: Working | null) => {
    setWorking((prev) => {
      const next = { ...prev };
      if (kind) next[id] = kind;
      else delete next[id];
      return next;
    });
  }, []);

  // Creates the Jira issue for a tagged ticket and records it on the ticket.
  const pushToJira = useCallback(
    async (t: Ticket, tag: Tag) => {
      mark(t.id, "jira");
      try {
        const data = await call<{ issue: { key: string; url: string | null } }>(
          "POST",
          "/api/jira",
          "Create Jira issue + link back in Intercom",
          { ticket: { id: t.id, subject: t.subject }, tag, summary: defaultSummary(t, tag), description: defaultDescription(t, tag) }
        );
        patchTicket(t.id, { jira: data.issue });
      } finally {
        mark(t.id, null);
      }
    },
    [call, mark, patchTicket]
  );

  // Automatic pipeline: keywords -> tag in Intercom -> Jira issue, for every ticket, one after another.
  const runAuto = useCallback(
    async (list: Ticket[], token: number) => {
      for (const t of list) {
        if (token !== runId.current) return;
        try {
          let tag = productTagOf(t);
          let tags = t.tags;

          if (!tag) {
            const s = suggestTag(t.subject, t.body);
            if (s.tag && s.total >= AUTO_TAG_MIN_MATCHES) {
              const suggested = s.tag;
              mark(t.id, "tag");
              try {
                await call("POST", "/api/tag", `Auto-tag ${suggested} in Intercom`, { id: t.id, tag: suggested });
              } finally {
                mark(t.id, null);
              }
              if (token !== runId.current) return;
              tag = suggested;
              tags = Array.from(new Set([...t.tags, suggested]));
              patchTicket(t.id, { tags });
            }
          }

          if (tag && !t.jira) {
            if (token !== runId.current) return;
            await pushToJira({ ...t, tags }, tag);
          }
        } catch (e) {
          setError(`${t.subject}: ${e instanceof Error ? e.message : "Automation failed"}`);
        }
      }
    },
    [call, mark, patchTicket, pushToJira]
  );

  const loadTickets = useCallback(async () => {
    const token = ++runId.current;
    setError(null);
    setTickets(null);
    setSelectedId(null);
    setWorking({});
    try {
      const data = await call<{ tickets: Ticket[] }>("GET", "/api/tickets", "Fetch tickets from Intercom");
      if (token !== runId.current) return;
      setTickets(data.tickets);
      void runAuto(data.tickets, token);
    } catch (e) {
      if (token !== runId.current) return;
      setTickets([]);
      setError(e instanceof Error ? e.message : "Could not load tickets");
    }
  }, [call, runAuto]);

  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then((c: AppConfig) => setConfig(c))
      .catch(() => setError("Could not load config"));
    loadTickets();
  }, [loadTickets]);

  const selected = useMemo(() => tickets?.find((t) => t.id === selectedId) ?? null, [tickets, selectedId]);
  const appliedTag = selected ? productTagOf(selected) : undefined;
  const suggestion = useMemo(() => (selected ? suggestTag(selected.subject, selected.body) : null), [selected]);
  const selWorking = selected ? working[selected.id] : undefined;

  const step = !selected ? 1 : selected.jira ? 4 : appliedTag ? 3 : 2;

  // Override: remove the current tag and/or apply another. If a Jira issue
  // already exists it is updated to match; otherwise one is created.
  async function changeTag(t: Ticket, next: Tag | null) {
    const current = productTagOf(t);
    if (current === next || working[t.id]) return;
    setError(null);
    let tags = t.tags;
    try {
      mark(t.id, "tag");
      if (current) {
        await call("DELETE", "/api/tag", `Remove tag ${current} in Intercom`, { id: t.id, tag: current });
        tags = tags.filter((x) => x !== current);
        patchTicket(t.id, { tags });
      }
      if (next) {
        await call("POST", "/api/tag", `Apply tag ${next} in Intercom`, { id: t.id, tag: next });
        tags = Array.from(new Set([...tags, next]));
        patchTicket(t.id, { tags });
        if (t.jira) {
          mark(t.id, "jira");
          await call("PUT", "/api/jira", `Update Jira issue ${t.jira.key} to match ${next}`, {
            key: t.jira.key,
            tag: next,
            summary: defaultSummary(t, next),
            description: defaultDescription(t, next),
          });
        } else {
          await pushToJira({ ...t, tags }, next);
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not change the tag");
    } finally {
      mark(t.id, null);
    }
  }

  async function retryJira(t: Ticket, tag: Tag) {
    setError(null);
    try {
      await pushToJira(t, tag);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Jira create failed");
    }
  }

  return (
    <>
      {/* Header */}
      <header className="sticky top-0 z-20 border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-7">
          <div className="flex items-center gap-3">
            <div className="h-7 w-2.5 rounded-sm bg-gradient-to-b from-primary to-brand" />
            <div>
              <h1 className="text-[17px] font-semibold leading-tight tracking-tight">Support to Engineering Handoff</h1>
              <p className="text-xs text-muted-foreground">Proof of concept: Intercom ticket, tag, Jira issue</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <ModeBadge name="Intercom" live={config?.intercom === "live"} text={config ? (config.intercom === "live" ? "Live" : "Sample data") : "..."} />
            <ModeBadge name="Jira" live={config?.jira === "live"} text={config ? (config.jira === "live" ? "Live" : "Simulated") : "..."} />
            <Button variant="outline" size="sm" onClick={loadTickets}>
              <ResetIcon width={14} height={14} />
              {config?.intercom === "mock" ? "Reset demo" : "Reload"}
            </Button>
          </div>
        </div>
      </header>

      {/* Stepper */}
      <ol className="mx-auto flex max-w-7xl items-center px-4 pt-5 sm:px-7">
        {STEPS.map((label, i) => {
          const n = i + 1;
          const done = step === 4 || n < step;
          const active = !done && n === step;
          const last = i === STEPS.length - 1;
          return (
            <li key={label} className={cn("flex items-center", !last && "flex-1")}>
              <span
                className={cn(
                  "flex h-7 w-7 flex-none items-center justify-center rounded-full border-2 text-xs font-semibold transition",
                  done && "border-primary bg-primary text-primary-foreground",
                  active && "border-primary bg-card text-primary ring-4 ring-primary/15",
                  !done && !active && "border-input bg-card text-muted-foreground"
                )}
              >
                {done ? <CheckIcon width={14} height={14} /> : n}
              </span>
              <span
                className={cn(
                  "ml-2.5 hidden whitespace-nowrap text-[13px] sm:inline",
                  active ? "font-semibold text-foreground" : done ? "font-medium text-primary" : "font-medium text-muted-foreground"
                )}
              >
                {label}
              </span>
              {!last && <span className={cn("mx-3.5 h-0.5 flex-1 rounded", done ? "bg-primary" : "bg-border")} />}
            </li>
          );
        })}
      </ol>

      {/* Error banner */}
      {error && (
        <div className="mx-auto mt-4 max-w-7xl px-4 sm:px-7">
          <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive-soft px-4 py-2.5 text-[13px] text-destructive">
            {error}
          </div>
        </div>
      )}

      <main className="mx-auto grid max-w-7xl items-start gap-5 px-4 pb-12 pt-5 sm:px-7 lg:grid-cols-[370px_1fr]">
        {/* Inbox */}
        <Card className="overflow-hidden">
          <CardHeader className="flex-row items-center justify-between space-y-0 border-b bg-muted/50 px-4 py-3">
            <CardTitle className="flex items-center gap-2 text-[11.5px] font-semibold uppercase tracking-wider text-muted-foreground">
              <InboxIcon width={14} height={14} /> Intercom inbox
            </CardTitle>
            <Badge variant="muted">{tickets ? `${tickets.length} tickets` : "loading"}</Badge>
          </CardHeader>
          {tickets === null && <div className="px-5 py-14 text-center text-muted-foreground">Loading tickets...</div>}
          {tickets?.length === 0 && <div className="px-5 py-14 text-center text-muted-foreground">No tickets found.</div>}
          {tickets?.map((t) => {
            const tag = productTagOf(t);
            const isSel = t.id === selectedId;
            const w = working[t.id];
            return (
              <button
                key={t.id}
                onClick={() => setSelectedId(t.id)}
                className={cn(
                  "block w-full border-b px-4 py-3 text-left transition-colors last:border-b-0",
                  "hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                  isSel && "bg-primary/10 shadow-[inset_3px_0_0_hsl(var(--primary))] hover:bg-primary/10"
                )}
              >
                <div className="mb-0.5 text-sm font-semibold leading-snug">{t.subject}</div>
                <div className="flex justify-between gap-2 text-xs text-muted-foreground">
                  <span>{t.customer.org || t.customer.name}</span>
                  <span className="shrink-0">{timeAgo(t.createdAt)}</span>
                </div>
                {(tag || t.jira || w) && (
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    {tag && <Badge variant={tag}>{tag}</Badge>}
                    {t.jira && <Badge variant="jira">{t.jira.key}</Badge>}
                    {w && (
                      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Spinner className="h-3 w-3" />
                        {w === "tag" ? "Tagging in Intercom..." : "Creating Jira issue..."}
                      </span>
                    )}
                  </div>
                )}
              </button>
            );
          })}
        </Card>

        {/* Ticket detail */}
        <Card>
          <CardHeader className="space-y-0 border-b bg-muted/50 px-5 py-3">
            <CardTitle className="text-[11.5px] font-semibold uppercase tracking-wider text-muted-foreground">
              Ticket workflow
            </CardTitle>
          </CardHeader>

          {!selected && <div className="px-5 py-14 text-center text-muted-foreground">Pick a ticket on the left to see how it was handled.</div>}

          {selected && (
            <CardContent className="p-5 sm:p-6">
              <h2 className="text-xl font-semibold leading-snug tracking-tight">
                <Highlighted text={selected.subject} />
              </h2>
              <p className="mb-3.5 mt-1 text-[13px] text-muted-foreground">
                {selected.customer.name}
                {selected.customer.org ? `, ${selected.customer.org}` : ""} · {timeAgo(selected.createdAt)} · #{selected.id}
              </p>
              <div className="whitespace-pre-wrap rounded-lg border bg-muted/40 px-4 py-3.5 text-sm leading-relaxed">
                <Highlighted text={selected.body} />
              </div>
              <div className="mt-3 text-[13px] text-muted-foreground">
                <HighlightLegend />
              </div>

              {/* Tag */}
              <Card className="mt-5 shadow-sm">
                <CardHeader className="pb-3">
                  <CardTitle className="text-[15px]">2. Tag</CardTitle>
                  <CardDescription>
                    Applied automatically from the highlighted words. Click the × to remove it, or pick the other tag to switch.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {suggestion && !suggestion.tag && !appliedTag && (
                    <div className="mb-3.5 rounded-md border bg-muted/50 px-3.5 py-2 text-[13px]">
                      No clear signal in this ticket, so it was not tagged. You can still pick a tag below.
                    </div>
                  )}
                  <div className="flex flex-wrap gap-3">
                    {TAG_ORDER.map((tag) => (
                      <TagChoice
                        key={tag}
                        tag={tag}
                        applied={appliedTag === tag}
                        suggested={!appliedTag && suggestion?.tag === tag}
                        disabled={!!selWorking}
                        onAdd={() => changeTag(selected, tag)}
                        onRemove={() => changeTag(selected, null)}
                      />
                    ))}
                  </div>
                  {suggestion?.tag && suggestion.matched.length > 0 && (
                    <p className="mt-3 text-[12.5px] text-muted-foreground">
                      Matched: {suggestion.matched.join(", ")}
                    </p>
                  )}
                  {selWorking === "tag" && (
                    <p className="mt-2.5 flex items-center gap-2 text-[13px] text-muted-foreground">
                      <Spinner /> Updating tag in Intercom...
                    </p>
                  )}
                </CardContent>
              </Card>

              {/* Jira */}
              {selected.jira ? (
                <div className="mt-4 rounded-xl border border-success/30 bg-success-soft p-5">
                  <div className="text-[12.5px] font-semibold text-success">3. Jira issue</div>
                  <div className="font-mono text-2xl font-bold tracking-tight">{selected.jira.key}</div>
                  <p className="mt-1.5 text-sm">
                    {selected.jira.url ? (
                      <a
                        href={selected.jira.url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 font-semibold text-primary underline-offset-4 hover:underline"
                      >
                        Open in Jira <ExternalLinkIcon width={13} height={13} />
                      </a>
                    ) : (
                      <>Simulated issue (add Jira credentials to create real ones).</>
                    )}{" "}
                    Created automatically, and linked back on the Intercom conversation.
                  </p>
                  {appliedTag && config ? (
                    <div className="mt-3 space-y-2">
                      <div className="flex flex-wrap gap-2 text-[12.5px]">
                        <Badge variant="outline" className="bg-card font-normal">Project: <b className="ml-1 font-semibold">{config.project}</b></Badge>
                        <Badge variant="outline" className="bg-card font-normal">Type: <b className="ml-1 font-semibold">{config.issueTypes[appliedTag]}</b></Badge>
                        <Badge variant="outline" className="bg-card font-normal">Labels: <b className="ml-1 font-semibold">{appliedTag}, from-intercom</b></Badge>
                      </div>
                      <p className="text-[13px] text-muted-foreground">{defaultSummary(selected, appliedTag)}</p>
                    </div>
                  ) : (
                    <p className="mt-3 text-[13px] text-muted-foreground">
                      The tag was removed. The Jira issue stays linked; pick a tag above to update it.
                    </p>
                  )}
                  {selWorking === "jira" && (
                    <p className="mt-3 flex items-center gap-2 text-[13px] text-muted-foreground">
                      <Spinner /> Updating Jira issue...
                    </p>
                  )}
                </div>
              ) : selWorking === "jira" ? (
                <Card className="mt-4 shadow-sm">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-[15px]">
                      <Spinner /> 3. Creating Jira issue...
                    </CardTitle>
                  </CardHeader>
                </Card>
              ) : appliedTag ? (
                <Card className="mt-4 shadow-sm">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-[15px]">3. Jira issue</CardTitle>
                    <CardDescription>No Jira issue yet for this ticket.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Button disabled={!!selWorking} onClick={() => retryJira(selected, appliedTag)}>
                      Create Jira issue
                    </Button>
                  </CardContent>
                </Card>
              ) : (
                <Card className="mt-4 bg-muted/40 opacity-60 shadow-sm">
                  <CardHeader>
                    <CardTitle className="text-[15px]">3. Jira issue</CardTitle>
                    <CardDescription>A Jira issue is created automatically once the ticket has a tag.</CardDescription>
                  </CardHeader>
                </Card>
              )}
            </CardContent>
          )}
        </Card>

        {/* Activity log */}
        <Card className="overflow-hidden border-slate-900 bg-slate-950 text-slate-200 lg:col-span-2">
          <CardHeader className="flex-row items-center justify-between space-y-0 border-b border-slate-800 bg-slate-900 px-4 py-3">
            <CardTitle className="text-[11.5px] font-semibold uppercase tracking-wider text-slate-400">Activity log (API calls)</CardTitle>
            <span className="rounded-full border border-slate-700 bg-slate-800 px-2.5 py-0.5 text-[11.5px] font-medium text-slate-300">{log.length}</span>
          </CardHeader>
          {log.length === 0 ? (
            <div className="px-4 py-4 text-[13px] text-slate-400">Calls to Intercom and Jira will show up here as tickets are processed.</div>
          ) : (
            <ul className="max-h-56 overflow-auto font-mono text-xs">
              {log.map((l) => (
                <li key={l.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 border-b border-slate-800 px-4 py-2 last:border-b-0">
                  <span className="text-slate-500">{l.time}</span>
                  <span className="w-12 font-bold text-amber-300">{l.method}</span>
                  <span>{l.path}</span>
                  <span className={cn("font-semibold", l.status >= 200 && l.status < 300 ? "text-emerald-400" : "text-red-400")}>
                    {l.status || "ERR"}
                  </span>
                  <span className="text-slate-500">{l.ms}ms</span>
                  <span className="font-sans text-slate-400">{l.note}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </main>
    </>
  );
}
