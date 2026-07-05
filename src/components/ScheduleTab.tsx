"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import HouseSelect, { houseLabel } from "@/components/HouseSelect";

const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
type Day = (typeof DAYS)[number];
const DAY_LABEL: Record<Day, string> = { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" };
type ActionType = "onoff" | "do";
type Recurrence = "daily" | "weekly" | "everyNDays" | "biweekly" | "monthly";

type Version = {
  actionKey: string; effectiveDate: string; name: string; category: string; type: ActionType;
  days: Day[]; start: string; end: string; recurrence: Recurrence; interval: number; dayOfMonth: number;
  notes: string; changedBy: string; changedAt: string; house: string;
};

const CATEGORY_COLORS: Record<string, string> = {
  lighting: "#D4AF37", feed: "#2A8E9A", cleaning: "#6B7C80", blinds: "#002E35", manure: "#7A5C00", other: "#3F4849",
};
const colorFor = (c: string) => CATEGORY_COLORS[c.toLowerCase()] ?? "#3F4849";
const CATEGORY_SUGGESTIONS = ["lighting", "feed", "cleaning", "blinds", "manure", "other"];

const todayInSast = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Johannesburg" }).format(new Date());

function recurrenceSummary(v: Version): string {
  const cap = (d: string) => d[0].toUpperCase() + d.slice(1);
  switch (v.recurrence) {
    case "daily": return "Daily";
    case "everyNDays": return `Every ${v.interval} day${v.interval === 1 ? "" : "s"}`;
    case "monthly": return `Monthly on day ${v.dayOfMonth}`;
    case "biweekly": return `Biweekly · ${v.days.map(cap).join(", ")}`;
    default: return v.days.map(cap).join(", ");
  }
}
const timing = (v: Version) => (v.type === "onoff" ? `On ${v.start} → off ${v.end}` : `At ${v.start}`);

const emptyDraft = (): Version & { effectiveDate: string } => ({
  actionKey: "", effectiveDate: todayInSast(), name: "", category: "lighting", type: "onoff",
  days: [...DAYS], start: "06:00", end: "18:00", recurrence: "daily", interval: 2, dayOfMonth: 1,
  notes: "", changedBy: "", changedAt: "", house: "",
});

const inputStyle: React.CSSProperties = {
  border: "1px solid rgba(0,0,0,0.14)", background: "#fff", color: "var(--t1)",
  padding: "9px 11px", fontSize: 14, fontFamily: "var(--font-s)", width: "100%", outline: "none",
};
function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--t2)" }}>{label}</span>
      {children}
      {hint && <span style={{ fontSize: 11, color: "var(--t3)" }}>{hint}</span>}
    </label>
  );
}

export default function ScheduleTab() {
  const [versions, setVersions] = useState<Version[]>([]);
  const [asOf, setAsOf] = useState(todayInSast());
  const [draft, setDraft] = useState<Version & { effectiveDate: string }>(emptyDraft());
  const [historyKey, setHistoryKey] = useState<string | null>(null);
  const [status, setStatus] = useState<{ kind: "idle" | "saving" | "ok" | "error"; msg?: string }>({ kind: "idle" });

  const load = useCallback(async () => {
    const res = await fetch("/api/schedule");
    if (res.ok) setVersions((await res.json()).versions ?? []);
  }, []);
  useEffect(() => { load(); }, [load]);

  // Group versions per action, sorted by effective date ascending.
  const groups = useMemo(() => {
    const m = new Map<string, Version[]>();
    for (const v of versions) { const g = m.get(v.actionKey) ?? []; g.push(v); m.set(v.actionKey, g); }
    for (const g of m.values()) g.sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate));
    return m;
  }, [versions]);

  const actions = useMemo(() => {
    return [...groups.entries()].map(([key, g]) => {
      const current = [...g].reverse().find((v) => v.effectiveDate <= asOf) ?? null;
      const upcoming = g.find((v) => v.effectiveDate > asOf) ?? null;
      return { key, current: current ?? g[0], effectiveSince: current?.effectiveDate ?? g[0].effectiveDate, active: !!current, upcoming, history: g };
    }).sort((a, b) => a.current.name.localeCompare(b.current.name));
  }, [groups, asOf]);

  const editing = draft.actionKey !== "";

  function toggleDay(d: Day) {
    setDraft((x) => ({ ...x, days: x.days.includes(d) ? x.days.filter((y) => y !== d) : [...x.days, d] }));
  }
  function change(a: { current: Version; key: string }) {
    setDraft({ ...a.current, actionKey: a.key, effectiveDate: todayInSast() });
    setStatus({ kind: "idle" });
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function save() {
    setStatus({ kind: "saving" });
    const res = await fetch("/api/schedule", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(draft),
    });
    const data = await res.json();
    if (!res.ok) { setStatus({ kind: "error", msg: data.error ?? "Failed" }); return; }
    setStatus({ kind: "ok", msg: editing ? "Change saved" : "Action added" });
    setDraft(emptyDraft());
    load();
  }
  async function del(actionKey: string, effectiveDate?: string) {
    const all = !effectiveDate;
    if (!confirm(all ? "Delete this action and all its history?" : `Delete the version effective ${effectiveDate}?`)) return;
    const q = new URLSearchParams({ actionKey, ...(effectiveDate ? { effectiveDate } : {}) });
    await fetch(`/api/schedule?${q}`, { method: "DELETE" });
    load();
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Add / change form */}
      <section className="sa-panel" style={{ padding: 0 }}>
        <div className="sa-panel-hd sa-panel-hd--production">{editing ? `Change "${draft.name}"` : "Add a scheduled action"}</div>
        <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
            <Field label="Name"><input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} style={inputStyle} placeholder="e.g. House lights" /></Field>
            <Field label="House"><HouseSelect value={draft.house} onChange={(v) => setDraft({ ...draft, house: v })} style={inputStyle} /></Field>
            <Field label="Category (type your own)">
              <input list="sched-cats" value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })} style={inputStyle} />
              <datalist id="sched-cats">{CATEGORY_SUGGESTIONS.map((c) => <option key={c} value={c} />)}</datalist>
            </Field>
            <Field label="Type">
              <select value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value as ActionType })} style={inputStyle}>
                <option value="onoff">On / Off (block of time)</option>
                <option value="do">Do (one-off)</option>
              </select>
            </Field>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: draft.type === "onoff" ? "1fr 1fr 1fr 1.4fr" : "1fr 1fr 1.4fr", gap: 12 }}>
            <Field label={draft.type === "onoff" ? "On at" : "At"}><input type="time" value={draft.start} onChange={(e) => setDraft({ ...draft, start: e.target.value })} style={inputStyle} /></Field>
            {draft.type === "onoff" && <Field label="Off at"><input type="time" value={draft.end} onChange={(e) => setDraft({ ...draft, end: e.target.value })} style={inputStyle} /></Field>}
            <Field label="Repeats">
              <select value={draft.recurrence} onChange={(e) => setDraft({ ...draft, recurrence: e.target.value as Recurrence })} style={inputStyle}>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly (pick days)</option>
                <option value="everyNDays">Every N days</option>
                <option value="biweekly">Biweekly (pick days)</option>
                <option value="monthly">Monthly (day of month)</option>
              </select>
            </Field>
            <Field label="Effective date" hint={editing ? "When this change takes/took effect (past or future)" : "Start date (can backdate)"}>
              <input type="date" value={draft.effectiveDate} onChange={(e) => setDraft({ ...draft, effectiveDate: e.target.value })} style={inputStyle} />
            </Field>
          </div>

          {(draft.recurrence === "weekly" || draft.recurrence === "biweekly") && (
            <Field label="On days">
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {DAYS.map((d) => {
                  const on = draft.days.includes(d);
                  return <button key={d} type="button" onClick={() => toggleDay(d)}
                    style={{ padding: "7px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer", border: `1px solid ${on ? "var(--teal)" : "rgba(0,0,0,0.14)"}`, background: on ? "var(--teal)" : "#fff", color: on ? "#fff" : "var(--t2)" }}>{DAY_LABEL[d]}</button>;
                })}
              </div>
            </Field>
          )}
          {draft.recurrence === "everyNDays" && <Field label="Every N days"><input type="number" min={1} value={draft.interval} onChange={(e) => setDraft({ ...draft, interval: Number(e.target.value) })} style={{ ...inputStyle, maxWidth: 140 }} /></Field>}
          {draft.recurrence === "monthly" && <Field label="Day of month"><input type="number" min={1} max={31} value={draft.dayOfMonth} onChange={(e) => setDraft({ ...draft, dayOfMonth: Number(e.target.value) })} style={{ ...inputStyle, maxWidth: 140 }} /></Field>}

          <Field label="Notes"><input value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} style={inputStyle} placeholder="Optional" /></Field>

          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <button onClick={save} disabled={status.kind === "saving"}
              style={{ background: "var(--primary)", color: "#fff", border: "none", padding: "11px 22px", fontSize: 14, fontWeight: 700, cursor: "pointer", opacity: status.kind === "saving" ? 0.6 : 1 }}>
              {status.kind === "saving" ? "Saving…" : editing ? "Save change" : "Add action"}
            </button>
            {editing && <button onClick={() => setDraft(emptyDraft())} style={{ background: "transparent", border: "none", color: "var(--t3)", fontWeight: 700, cursor: "pointer" }}>Cancel</button>}
            {status.kind === "ok" && <span style={{ color: "var(--ok)", fontSize: 13, fontWeight: 600 }}>{status.msg}</span>}
            {status.kind === "error" && <span style={{ color: "var(--danger)", fontSize: 13, fontWeight: 600 }}>{status.msg}</span>}
          </div>
        </div>
      </section>

      {/* Current schedule (as-of a date) */}
      <section className="sa-panel" style={{ padding: 0 }}>
        <div className="sa-panel-hd sa-panel-hd--welfare" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
          <span>Schedule</span>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 6, textTransform: "none", letterSpacing: 0, fontWeight: 600, fontSize: 12, color: "var(--t2)" }}>
            As of <input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} style={{ ...inputStyle, padding: "4px 6px", width: "auto", fontSize: 12 }} />
          </label>
        </div>
        <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
          {actions.map((a) => (
            <div key={a.key} style={{ border: "1px solid var(--divider)", padding: 12 }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
                <span style={{ width: 10, height: 10, background: colorFor(a.current.category), flexShrink: 0, marginTop: 4 }} />
                <div style={{ flex: 1, minWidth: 200 }}>
                  <div style={{ fontWeight: 700 }}>{a.current.name} {!a.active && <span style={{ color: "var(--t3)", fontWeight: 600, fontSize: 12 }}>(starts {a.effectiveSince})</span>}</div>
                  <div style={{ fontSize: 12.5, color: "var(--t2)", marginTop: 2 }}>{timing(a.current)} · {recurrenceSummary(a.current)} · {houseLabel(a.current.house)}</div>
                  <div style={{ fontSize: 11, color: "var(--t3)", marginTop: 2 }}>In effect since {a.effectiveSince}</div>
                  {a.upcoming && (
                    <div style={{ fontSize: 12, color: "var(--teal)", fontWeight: 600, marginTop: 4 }}>
                      → Changes {a.upcoming.effectiveDate}: {timing(a.upcoming)} · {recurrenceSummary(a.upcoming)}
                    </div>
                  )}
                </div>
                <div style={{ display: "flex", gap: 12, flexShrink: 0 }}>
                  <button onClick={() => change(a)} style={linkBtn("var(--teal)")}>Change</button>
                  <button onClick={() => setHistoryKey(historyKey === a.key ? null : a.key)} style={linkBtn("var(--t2)")}>History ({a.history.length})</button>
                  <button onClick={() => del(a.key)} style={linkBtn("var(--danger)")}>Delete</button>
                </div>
              </div>

              {historyKey === a.key && (
                <div style={{ marginTop: 10, borderTop: "1px solid var(--divider)", paddingTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
                  {[...a.history].reverse().map((v) => (
                    <div key={v.effectiveDate + v.changedAt} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12, color: "var(--t2)" }}>
                      <span style={{ fontWeight: 700, color: "var(--t1)", minWidth: 92 }}>{v.effectiveDate}</span>
                      <span style={{ flex: 1 }}>{timing(v)} · {recurrenceSummary(v)}{v.changedBy ? ` — ${v.changedBy}` : ""}</span>
                      <button onClick={() => del(a.key, v.effectiveDate)} style={linkBtn("var(--danger)")}>Remove</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
          {actions.length === 0 && <div style={{ padding: "20px 12px", color: "var(--t3)", textAlign: "center" }}>No scheduled actions yet — add one above.</div>}
        </div>
      </section>
    </div>
  );
}

const linkBtn = (color: string): React.CSSProperties => ({ background: "transparent", border: "none", color, fontWeight: 700, fontSize: 12, cursor: "pointer", padding: 0 });
