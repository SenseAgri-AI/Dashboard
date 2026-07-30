"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

// Flock Vet — the in-app AI vet / husbandry advisor. Chat UI holds the conversation
// client-side and POSTs the running history to /api/agent/chat, which runs the
// farm-scoped Claude tool loop. Mobile-first: inline styles + a matchMedia hook, ≥44px
// touch targets, no horizontal scroll.

const PRIMARY = "#002E35";
const TEAL = "#2A8E9A";
const GOLD = "#D4AF37";

type Msg = { role: "user" | "assistant"; content: string; tools?: string[] };

const STARTERS = [
  "How is my flock doing?",
  "Why did egg production drop recently?",
  "Is my ventilation and air quality OK?",
  "Is my lay rate on target for the flock's age?",
];

const TOOL_LABEL: Record<string, string> = {
  get_flock_snapshot: "flock snapshot",
  query_flock_history: "production history",
  get_recent_environment: "barn environment",
  get_events: "farm events",
  get_schedule: "schedules",
  compare_to_breed_standard: "breed-standard comparison",
};

function useIsNarrow(px = 760) {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${px}px)`);
    const on = () => setNarrow(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [px]);
  return narrow;
}

// Minimal, safe markdown → React nodes: paragraphs, bullet/numbered lists, **bold**,
// `code`. No raw HTML injection (builds React nodes, never dangerouslySetInnerHTML).
function renderInline(text: string, keyBase: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const re = /(\*\*([^*]+)\*\*|`([^`]+)`)/g;
  let last = 0, m: RegExpExecArray | null, i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    if (m[2] != null) nodes.push(<strong key={`${keyBase}-b${i}`}>{m[2]}</strong>);
    else if (m[3] != null) nodes.push(
      <code key={`${keyBase}-c${i}`} style={{ background: "rgba(0,0,0,0.06)", padding: "1px 5px", borderRadius: 4, fontSize: "0.9em" }}>{m[3]}</code>
    );
    last = m.index + m[0].length; i++;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

function Markdown({ text }: { text: string }) {
  const lines = text.split("\n");
  const blocks: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flushList = (k: string) => {
    if (!list) return;
    const items = list.items.map((it, j) => <li key={`${k}-li${j}`} style={{ marginBottom: 3 }}>{renderInline(it, `${k}-li${j}`)}</li>);
    blocks.push(
      list.ordered
        ? <ol key={k} style={{ margin: "4px 0 8px", paddingLeft: 20 }}>{items}</ol>
        : <ul key={k} style={{ margin: "4px 0 8px", paddingLeft: 20 }}>{items}</ul>
    );
    list = null;
  };
  lines.forEach((raw, idx) => {
    const line = raw.trimEnd();
    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    const ordered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (bullet) {
      if (!list || list.ordered) flushList(`l${idx}`);
      list = list ?? { ordered: false, items: [] };
      list.items.push(bullet[1]);
    } else if (ordered) {
      if (!list || !list.ordered) flushList(`l${idx}`);
      list = list ?? { ordered: true, items: [] };
      list.items.push(ordered[1]);
    } else {
      flushList(`l${idx}`);
      if (line.trim()) blocks.push(<p key={`p${idx}`} style={{ margin: "0 0 8px", lineHeight: 1.5 }}>{renderInline(line, `p${idx}`)}</p>);
    }
  });
  flushList("lend");
  return <>{blocks}</>;
}

export default function AssistantPage() {
  const narrow = useIsNarrow();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notConfigured, setNotConfigured] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, busy]);

  const send = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setError(null);
    const next: Msg[] = [...messages, { role: "user", content: trimmed }];
    setMessages(next);
    setInput("");
    setBusy(true);
    try {
      const res = await fetch("/api/agent/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next.map((m) => ({ role: m.role, content: m.content })) }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 503 && data.notConfigured) {
        setNotConfigured(true);
        setMessages((m) => [...m, { role: "assistant", content: "The Flock Vet assistant isn't switched on for your farm yet. Please check back soon — your administrator is finalising setup." }]);
        return;
      }
      if (!res.ok) {
        setError(data.error || "Something went wrong. Please try again.");
        setMessages((m) => m.slice(0, -1)); // drop the user msg so they can retry
        setInput(trimmed);
        return;
      }
      setMessages((m) => [...m, { role: "assistant", content: data.reply, tools: data.toolsUsed }]);
    } catch {
      setError("Network error. Please try again.");
      setMessages((m) => m.slice(0, -1));
      setInput(trimmed);
    } finally {
      setBusy(false);
    }
  }, [busy, messages]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send(input);
    }
  };

  const empty = messages.length === 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "calc(100dvh - var(--topbar-h, 56px))", minHeight: 0, background: "var(--bg, #F5F3EE)" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: narrow ? "12px 16px" : "16px 24px", borderBottom: "1px solid var(--divider)", background: "#fff", flexShrink: 0 }}>
        <div style={{ width: 40, height: 40, borderRadius: 10, background: PRIMARY, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4.8 2.3A.3.3 0 1 0 5 2a.3.3 0 0 0-.2.3" /><path d="M8 15v-3a4 4 0 0 0-8 0v3" transform="translate(2 0)" />
            <path d="M4.5 2.5V6a4.5 4.5 0 0 0 9 0V2.5" /><circle cx="20" cy="10" r="2" /><path d="M18 10v4a6 6 0 0 1-12 0v-1" />
          </svg>
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontFamily: "var(--font-d)", fontWeight: 800, fontSize: narrow ? 17 : 20, color: PRIMARY, lineHeight: 1.1 }}>Flock Vet</div>
          <div style={{ fontSize: 12, color: "var(--t3)" }}>AI advisor grounded in your farm&apos;s data</div>
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: narrow ? "14px 12px" : "22px 24px", minHeight: 0 }}>
        <div style={{ maxWidth: 820, margin: "0 auto", display: "flex", flexDirection: "column", gap: 14 }}>
          {empty && (
            <div style={{ display: "flex", flexDirection: "column", gap: 16, marginTop: narrow ? 8 : 24 }}>
              <div style={{ background: "#fff", border: "1px solid var(--divider)", borderLeft: `3px solid ${TEAL}`, padding: "14px 16px", borderRadius: 8 }}>
                <div style={{ fontWeight: 700, color: PRIMARY, marginBottom: 4 }}>Ask about your flock</div>
                <div style={{ fontSize: 13.5, color: "var(--t2)", lineHeight: 1.5 }}>
                  I can look at your production history, mortality, egg quality, barn environment, events and schedules to help you spot problems and decide what to do. I give husbandry and veterinary <strong>decision-support</strong> — for anything clinical or urgent, please still contact a licensed vet.
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: narrow ? "1fr" : "1fr 1fr", gap: 10 }}>
                {STARTERS.map((s) => (
                  <button key={s} onClick={() => send(s)} disabled={busy}
                    style={{ textAlign: "left", padding: "12px 14px", minHeight: 48, border: "1px solid var(--divider)", background: "#fff", borderRadius: 8, cursor: busy ? "default" : "pointer", fontSize: 13.5, color: "var(--t1)", fontFamily: "var(--font-s)", lineHeight: 1.4 }}>
                    <span style={{ color: GOLD, fontWeight: 800, marginRight: 6 }}>›</span>{s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m, i) => (
            <div key={i} style={{ display: "flex", justifyContent: m.role === "user" ? "flex-end" : "flex-start" }}>
              <div style={{ maxWidth: m.role === "user" ? "85%" : "100%" }}>
                {m.role === "assistant" && m.tools && m.tools.length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 6 }}>
                    {m.tools.map((t) => (
                      <span key={t} style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: TEAL, border: `1px solid ${TEAL}`, borderRadius: 3, padding: "1px 6px" }}>
                        {TOOL_LABEL[t] ?? t}
                      </span>
                    ))}
                  </div>
                )}
                <div style={m.role === "user"
                  ? { background: PRIMARY, color: "#fff", padding: "10px 14px", borderRadius: "12px 12px 3px 12px", fontSize: 14.5, lineHeight: 1.5, whiteSpace: "pre-wrap", wordBreak: "break-word" }
                  : { background: "#fff", color: "var(--t1)", padding: "12px 16px", borderRadius: "3px 12px 12px 12px", border: "1px solid var(--divider)", fontSize: 14.5 }}>
                  {m.role === "user" ? m.content : <Markdown text={m.content} />}
                </div>
              </div>
            </div>
          ))}

          {busy && (
            <div style={{ display: "flex", justifyContent: "flex-start" }}>
              <div style={{ background: "#fff", border: "1px solid var(--divider)", borderRadius: "3px 12px 12px 12px", padding: "12px 16px", display: "inline-flex", alignItems: "center", gap: 10, color: "var(--t3)", fontSize: 13.5 }}>
                <span style={{ display: "inline-flex", gap: 3 }}>
                  <Dot delay={0} /><Dot delay={0.15} /><Dot delay={0.3} />
                </span>
                Checking your flock data…
              </div>
            </div>
          )}

          {error && (
            <div style={{ background: "#FEF2F2", border: "1px solid #FCA5A5", color: "#991B1B", padding: "10px 14px", borderRadius: 8, fontSize: 13 }}>{error}</div>
          )}
        </div>
      </div>

      {/* Composer */}
      <div style={{ borderTop: "1px solid var(--divider)", background: "#fff", padding: narrow ? "10px 12px" : "14px 24px", flexShrink: 0 }}>
        <div style={{ maxWidth: 820, margin: "0 auto", display: "flex", gap: 10, alignItems: "flex-end" }}>
          <textarea
            ref={taRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={notConfigured ? "Assistant not enabled yet…" : "Ask about production, mortality, egg quality, environment…"}
            rows={1}
            disabled={busy}
            style={{ flex: 1, resize: "none", maxHeight: 140, minHeight: 44, padding: "11px 14px", border: "1px solid var(--divider)", borderRadius: 10, fontSize: 15, fontFamily: "var(--font-s)", color: "var(--t1)", outline: "none", lineHeight: 1.4, background: busy ? "#F7F7F5" : "#fff" }}
          />
          <button
            onClick={() => send(input)}
            disabled={busy || !input.trim()}
            aria-label="Send"
            style={{ flexShrink: 0, width: 44, height: 44, borderRadius: 10, border: "none", background: busy || !input.trim() ? "#B9C4C5" : PRIMARY, color: "#fff", cursor: busy || !input.trim() ? "default" : "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 2 11 13" /><path d="M22 2 15 22l-4-9-9-4 20-7Z" />
            </svg>
          </button>
        </div>
        <div style={{ maxWidth: 820, margin: "6px auto 0", fontSize: 10.5, color: "var(--t4)", textAlign: "center" }}>
          Decision-support only — not a substitute for a licensed veterinarian.
        </div>
      </div>

      <style>{`@keyframes sa-bounce{0%,80%,100%{transform:translateY(0);opacity:.4}40%{transform:translateY(-4px);opacity:1}}`}</style>
    </div>
  );
}

function Dot({ delay }: { delay: number }) {
  return <span style={{ width: 6, height: 6, borderRadius: "50%", background: TEAL, display: "inline-block", animation: `sa-bounce 1.2s ${delay}s infinite ease-in-out` }} />;
}
