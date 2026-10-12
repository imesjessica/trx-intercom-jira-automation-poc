"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TAGS, type AppConfig, type Tag, type Ticket } from "@/lib/types";
import { suggestTag, AUTO_TAG_MIN_MATCHES } from "@/lib/keywords";
import { Highlighted, HighlightLegend } from "./Highlighted";

interface LogEntry {
  id: number;
  time: string;
  method: string;
  path: string;
  status: number;
  ms: number;
  note: string;
}

const STEPS = ["Inbox", "Tag", "Push to Jira", "Done"];

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

export default function Page() {
  const [tickets, setTickets] = useState<Ticket[] | null>(null);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState<"tag" | "jira" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [summary, setSummary] = useState("");
  const [description, setDescription] = useState("");
  const [autoTag, setAutoTag] = useState(true);
  const autoTried = useRef<Set<string>>(new Set());

  const addLog = useCallback((e: Omit<LogEntry, "id" | "time">) => {
    setLog((prev) => [{ ...e, id: Date.now() + Math.random(), time: new Date().toLocaleTimeString() }, ...prev]);
  }, []);

  const call = useCallback(
    async <T,>(method: "GET" | "POST", path: string, note: string, body?: unknown): Promise<T> => {
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

  const loadTickets = useCallback(async () => {
    setError(null);
    setTickets(null);
    autoTried.current.clear();
    setSelectedId(null);
    try {
      const data = await call<{ tickets: Ticket[] }>("GET", "/api/tickets", "Fetch tickets from Intercom");
      setTickets(data.tickets);
    } catch (e) {
      setTickets([]);
      setError(e instanceof Error ? e.message : "Could not load tickets");
    }
  }, [call]);

  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then((c: AppConfig) => {
        setConfig(c);
        if (c.intercom === "live") setAutoTag(false); // never auto-write to a real inbox unless switched on
      })
      .catch(() => setError("Could not load config"));
    loadTickets();
  }, [loadTickets]);

  const selected = useMemo(() => tickets?.find((t) => t.id === selectedId) ?? null, [tickets, selectedId]);
  const appliedTag = (selected?.tags.find((t) => (TAGS as string[]).includes(t)) as Tag | undefined) ?? undefined;
  const suggestion = useMemo(() => (selected ? suggestTag(selected.subject, selected.body) : null), [selected]);

  const step = !selected ? 1 : selected.jira ? 4 : appliedTag ? 3 : 2;

  // Reset the editable Jira draft whenever the ticket or its tag changes.
  useEffect(() => {
    if (selected && appliedTag) {
      setSummary(defaultSummary(selected, appliedTag));
      setDescription(defaultDescription(selected, appliedTag));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id, appliedTag]);

  function patchTicket(id: string, patch: Partial<Ticket>) {
    setTickets((prev) => prev?.map((t) => (t.id === id ? { ...t, ...patch } : t)) ?? prev);
  }

  async function onTag(tag: Tag) {
    if (!selected) return;
    setBusy("tag");
    setError(null);
    try {
      await call("POST", "/api/tag", `Apply tag ${tag} in Intercom`, { id: selected.id, tag });
      patchTicket(selected.id, { tags: Array.from(new Set([...selected.tags, tag])) });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Tagging failed");
    } finally {
      setBusy(null);
    }
  }

  async function onJira() {
    if (!selected || !appliedTag) return;
    setBusy("jira");
    setError(null);
    try {
      const data = await call<{ issue: { key: string; url: string | null } }>(
        "POST",
        "/api/jira",
        "Create Jira issue + note back in Intercom",
        { ticket: { id: selected.id, subject: selected.subject }, tag: appliedTag, summary, description }
      );
      patchTicket(selected.id, { jira: data.issue });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Jira create failed");
    } finally {
      setBusy(null);
    }
  }

  // Auto-tag: when a ticket is opened and keywords clearly point one way, apply the tag.
  useEffect(() => {
    if (!autoTag || !selected || appliedTag || busy) return;
    if (!suggestion?.tag || suggestion.total < AUTO_TAG_MIN_MATCHES) return;
    if (autoTried.current.has(selected.id)) return; // one attempt per ticket
    autoTried.current.add(selected.id);
    onTag(suggestion.tag);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoTag, selected?.id, suggestion?.tag, appliedTag]);

  const rec = suggestion?.tag ?? null;

  return (
    <>
      <div className="topbar">
        <div className="brand">
          <h1>Support to Engineering Handoff</h1>
          <span>Proof of concept: Intercom ticket, tag, Jira issue</span>
        </div>
        <div className="modes">
          <span className={`mode ${config?.intercom === "live" ? "live" : ""}`}>
            Intercom: <b>{config ? (config.intercom === "live" ? "Live" : "Sample data") : "..."}</b>
          </span>
          <span className={`mode ${config?.jira === "live" ? "live" : ""}`}>
            Jira: <b>{config ? (config.jira === "live" ? "Live" : "Simulated") : "..."}</b>
          </span>
          <button className="ghost" onClick={loadTickets} disabled={busy !== null}>
            {config?.intercom === "mock" ? "Reset demo" : "Reload"}
          </button>
        </div>
      </div>

      <div className="stepper">
        {STEPS.map((label, i) => {
          const n = i + 1;
          const cls = step === 4 || n < step ? "done" : n === step ? "active" : "";
          return (
            <div key={label} className={`step ${cls}`}>
              <span className="dot">{cls === "done" ? "✓" : n}</span>
              <span className="label">{label}</span>
            </div>
          );
        })}
      </div>

      {error && <div className="error">{error}</div>}

      <main className="shell">
        {/* Step 1: inbox */}
        <section className="panel">
          <header>
            <h2>Intercom inbox</h2>
            <span className="chip other">{tickets ? `${tickets.length} tickets` : "loading"}</span>
          </header>
          {tickets === null && <div className="empty">Loading tickets...</div>}
          {tickets?.length === 0 && <div className="empty">No tickets found.</div>}
          {tickets?.map((t) => {
            const tag = t.tags.find((x) => (TAGS as string[]).includes(x));
            return (
              <button key={t.id} className={`ticket ${t.id === selectedId ? "sel" : ""}`} onClick={() => setSelectedId(t.id)}>
                <div className="subj">{t.subject}</div>
                <div className="meta">
                  <span>{t.customer.org || t.customer.name}</span>
                  <span>{timeAgo(t.createdAt)}</span>
                </div>
                {(tag || t.jira) && (
                  <div className="chips">
                    {tag && <span className={`chip ${tag}`}>{tag}</span>}
                    {t.jira && <span className="chip jira">{t.jira.key}</span>}
                  </div>
                )}
              </button>
            );
          })}
        </section>

        {/* Steps 2-4: detail */}
        <section className="panel">
          <header>
            <h2>Ticket workflow</h2>
          </header>

          {!selected && <div className="empty">Pick a ticket on the left to start the handoff.</div>}

          {selected && (
            <div className="detail">
              <h3>
                <Highlighted text={selected.subject} />
              </h3>
              <div className="from">
                {selected.customer.name}
                {selected.customer.org ? `, ${selected.customer.org}` : ""} · {timeAgo(selected.createdAt)} · #{selected.id}
              </div>
              <div className="body-box">
                <Highlighted text={selected.body} />
              </div>
              <div className="from" style={{ marginTop: 8, display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center" }}>
                <HighlightLegend />
                <label>
                  <input type="checkbox" checked={autoTag} onChange={(e) => setAutoTag(e.target.checked)} /> Auto-tag when
                  keywords are found
                </label>
              </div>

              {/* Tag */}
              <div className="card">
                <h4>2. Tag the ticket</h4>
                <p className="hint">The tag is written back to the conversation in Intercom.</p>
                {suggestion && (
                  <div className="suggest">
                    {suggestion.tag ? (
                      <>
                        Suggested: <b>{suggestion.tag}</b> (matched: {suggestion.matched.join(", ")})
                      </>
                    ) : (
                      <>No clear signal. This one probably does not need engineering.</>
                    )}
                  </div>
                )}
                {appliedTag ? (
                  <span className={`chip ${appliedTag}`}>Tagged: {appliedTag}</span>
                ) : (
                  <div className="row">
                    <button className={`tagbtn product_bug ${rec === "product_bug" ? "rec" : ""}`} disabled={busy !== null} onClick={() => onTag("product_bug")}>
                      <b>product_bug</b>
                      <small>Something is broken or behaving wrongly</small>
                    </button>
                    <button className={`tagbtn product_feedback ${rec === "product_feedback" ? "rec" : ""}`} disabled={busy !== null} onClick={() => onTag("product_feedback")}>
                      <b>product_feedback</b>
                      <small>Feature request or improvement idea</small>
                    </button>
                  </div>
                )}
                {busy === "tag" && <p className="hint" style={{ marginTop: 10 }}>Tagging in Intercom...</p>}
              </div>

              {/* Jira */}
              {selected.jira ? (
                <div className="success">
                  <div className="hint" style={{ margin: 0 }}>4. Escalated</div>
                  <div className="key">{selected.jira.key}</div>
                  <p style={{ margin: "6px 0 0" }}>
                    {selected.jira.url ? (
                      <a href={selected.jira.url} target="_blank" rel="noreferrer">
                        Open in Jira
                      </a>
                    ) : (
                      <>Simulated issue (add Jira credentials to create real ones).</>
                    )}
                    {" "}
                    A note with this key is added to the Intercom conversation so support can see it.
                  </p>
                </div>
              ) : (
                <div className={`card ${appliedTag ? "" : "locked"}`}>
                  <h4>3. Push to Jira</h4>
                  <p className="hint">Review what engineering will see, then create the issue.</p>
                  {appliedTag && config && (
                    <div className="kv">
                      <span>Project: <b>{config.project}</b></span>
                      <span>Type: <b>{config.issueTypes[appliedTag]}</b></span>
                      <span>Labels: <b>{appliedTag}, from-intercom</b></span>
                    </div>
                  )}
                  <label className="f">Summary</label>
                  <input className="t" value={summary} disabled={!appliedTag || busy !== null} onChange={(e) => setSummary(e.target.value)} />
                  <label className="f">Description</label>
                  <textarea className="t" value={description} disabled={!appliedTag || busy !== null} onChange={(e) => setDescription(e.target.value)} />
                  <button className="primary" disabled={!appliedTag || busy !== null || !summary.trim()} onClick={onJira}>
                    {busy === "jira" && <span className="spinner" />}
                    {busy === "jira" ? "Creating issue..." : "Create Jira issue"}
                  </button>
                </div>
              )}
            </div>
          )}
        </section>

        {/* Activity log */}
        <section className="panel log">
          <header>
            <h2>Activity log (API calls)</h2>
            <span className="chip other">{log.length}</span>
          </header>
          {log.length === 0 ? (
            <div className="none">Calls to Intercom and Jira will show up here as you click through.</div>
          ) : (
            <ul>
              {log.map((l) => (
                <li key={l.id}>
                  <span className="t">{l.time}</span>
                  <span className="m">{l.method}</span>
                  <span>{l.path}</span>
                  <span className={`s ${l.status >= 200 && l.status < 300 ? "ok" : "bad"}`}>{l.status || "ERR"}</span>
                  <span className="t">{l.ms}ms</span>
                  <span className="n">{l.note}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </>
  );
}
