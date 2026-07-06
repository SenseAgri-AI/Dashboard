"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import HouseSelect, { houseLabel } from "@/components/HouseSelect";

const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
type Day = (typeof DAYS)[number];
const DAY_LABEL: Record<Day, string> = { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" };
type ActionType = "onoff" | "do" | "cycle";
type Recurrence = "daily" | "hourly" | "weekly" | "everyNDays" | "biweekly" | "monthly";
type TimeSlot = { start: string; end: string };

// One dated version of a schedule = its full set of times at that point in time.
type Version = {
  scheduleId: string; effectiveDate: string; name: string; house: string; type: ActionType;
  recurrence: Recurrence; interval: number; dayOfMonth: number; days: Day[];
  times: TimeSlot[]; runMinutes: number; everyMinutes: number; notes: string; changedBy: string; changedAt: string;
};

// Colour is derived from the name — common names get a fixed colour, anything else
// gets a stable colour hashed from the name, so each schedule stays visually distinct.
const PALETTE = ["#2A8E9A", "#D4AF37", "#7A5C00", "#6B7C80", "#002E35", "#166534", "#B91C1C", "#92400E"];
const PRESET_COLORS: Record<string, string> = {
  lights: "#D4AF37", lighting: "#D4AF37", fans: "#2A8E9A", ventilation: "#2A8E9A",
  feed: "#7A5C00", feeder: "#7A5C00", cleaning: "#6B7C80", blinds: "#002E35", "manure belt": "#166534", manure: "#166534",
};
function colorFor(name: string): string {
  const key = (name ?? "").trim().toLowerCase();
  if (PRESET_COLORS[key]) return PRESET_COLORS[key];
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length] ?? "#3F4849";
}
const NAME_SUGGESTIONS = ["Lights", "Fans", "Feeder run", "Manure belt", "Cleaning", "Blinds", "Feed"];

const todayInSast = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Johannesburg" }).format(new Date());

function recurrenceSummary(v: Version): string {
  const cap = (d: string) => d[0].toUpperCase() + d.slice(1);
  switch (v.recurrence) {
    case "daily": return "Daily";
    case "hourly": return `Every ${v.interval} hour${v.interval === 1 ? "" : "s"}`;
    case "everyNDays": return `Every ${v.interval} day${v.interval === 1 ? "" : "s"}`;
    case "monthly": return `Monthly on day ${v.dayOfMonth}`;
    case "biweekly": return `Biweekly · ${v.days.map(cap).join(", ")}`;
    default: return v.days.map(cap).join(", ");
  }
}
// The set of times, shown together: "07:00, 13:00, 17:00" or "06:00→18:00, 20:00→22:00".
function timesSummary(v: Version): string {
  if (!v.times.length) return "—";
  const window = v.type === "onoff" || v.type === "cycle";
  return v.times.map((t) => (window && t.end ? `${t.start}→${t.end}` : t.start)).join(", ");
}
// For fan-style cycles: "Runs 5 min every 30 min".
const cycleSummary = (v: Version) => (v.type === "cycle" ? `Runs ${v.runMinutes} min every ${v.everyMinutes} min` : "");

const emptyDraft = (): Version => ({
  scheduleId: "", effectiveDate: todayInSast(), name: "", house: "", type: "do",
  recurrence: "daily", interval: 2, dayOfMonth: 1, days: [...DAYS],
  times: [{ start: "07:00", end: "" }], runMinutes: 5, everyMinutes: 30, notes: "", changedBy: "", changedAt: "",
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
const linkBtn = (color: string): React.CSSProperties => ({ background: "transparent", border: "none", color, fontWeight: 700, fontSize: 12, cursor: "pointer", padding: 0 });

export default function ScheduleTab() {
  const [versions, setVersions] = useState<Version[]>([]);
  const [draft, setDraft] = useState<Version>(emptyDraft());
  const [openHistory, setOpenHistory] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState<{ kind: "idle" | "saving" | "ok" | "error"; msg?: string }>({ kind: "idle" });

  const load = useCallback(async () => {
    const res = await fetch("/api/schedule");
    if (res.ok) setVersions((await res.json()).versions ?? []);
  }, []);
  useEffect(() => { load(); }, [load]);

  // Group versions into schedules by NAME + house (how the user thinks of a schedule);
  // newest version = the current one, the rest = its change history.
  const schedules = useMemo(() => {
    const m = new Map<string, Version[]>();
    for (const v of versions) {
      const key = `${v.name.trim().toLowerCase()}||${v.house}`;
      const g = m.get(key) ?? [];
      g.push(v);
      m.set(key, g);
    }
    const list = [...m.entries()].map(([key, g]) => {
      g.sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate) || b.changedAt.localeCompare(a.changedAt));
      return { key, name: g[0].name, house: g[0].house, current: g[0], history: g.slice(1) };
    });
    list.sort((a, b) => a.name.localeCompare(b.name));
    return list;
  }, [versions]);

  // Remember every schedule name ever used + the presets → dropdown suggestions.
  const nameOptions = useMemo(() => {
    const set = new Set<string>(NAME_SUGGESTIONS);
    for (const v of versions) if (v.name?.trim()) set.add(v.name.trim());
    return [...set];
  }, [versions]);

  const editing = draft.scheduleId !== "";

  function toggleDay(d: Day) {
    setDraft((x) => ({ ...x, days: x.days.includes(d) ? x.days.filter((y) => y !== d) : [...x.days, d] }));
  }
  function setTime(i: number, patch: Partial<TimeSlot>) {
    setDraft((x) => ({ ...x, times: x.times.map((t, j) => (j === i ? { ...t, ...patch } : t)) }));
  }
  function addTime() {
    setDraft((x) => ({ ...x, times: [...x.times, { start: "07:00", end: x.type !== "do" ? "18:00" : "" }] }));
  }
  function removeTime(i: number) {
    setDraft((x) => ({ ...x, times: x.times.length > 1 ? x.times.filter((_, j) => j !== i) : x.times }));
  }
  function reset() { setDraft(emptyDraft()); setStatus({ kind: "idle" }); }
  const focusForm = () => { if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" }); };

  // "Change" a schedule → start a NEW version dated today, pre-filled from the current times.
  // Saving it keeps the schedule's id, so the old version drops into history.
  function change(current: Version) {
    setDraft({ ...current, effectiveDate: todayInSast() });
    setStatus({ kind: "idle" });
    focusForm();
  }
  // "Edit" the current version in place (fix a mistake without making a new version).
  function edit(v: Version) {
    setDraft({ ...v });
    setStatus({ kind: "idle" });
    focusForm();
  }

  async function save() {
    setStatus({ kind: "saving" });
    const res = await fetch("/api/schedule", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(draft),
    });
    const data = await res.json();
    if (!res.ok) { setStatus({ kind: "error", msg: data.error ?? "Failed" }); return; }
    setStatus({ kind: "ok", msg: editing ? "Saved" : "Added" });
    reset();
    load();
  }
  async function delVersion(v: Version) {
    if (!confirm(`Remove the ${v.effectiveDate} version of "${v.name}"?`)) return;
    await fetch(`/api/schedule?scheduleId=${encodeURIComponent(v.scheduleId)}&effectiveDate=${encodeURIComponent(v.effectiveDate)}`, { method: "DELETE" });
    load();
  }
  async function delSchedule(s: { name: string; current: Version; history: Version[] }) {
    if (!confirm(`Delete "${s.name}" and all its history?`)) return;
    // A name-group can span more than one scheduleId, so remove every version in it.
    for (const v of [s.current, ...s.history]) {
      await fetch(`/api/schedule?scheduleId=${encodeURIComponent(v.scheduleId)}&effectiveDate=${encodeURIComponent(v.effectiveDate)}`, { method: "DELETE" });
    }
    load();
  }
  function toggleHistory(id: string) {
    setOpenHistory((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }

  const timeLabel = draft.type === "do" ? "Times" : draft.type === "cycle" ? "Window(s)" : "On / off times";
  const timeHint = draft.type === "do" ? "Add each time it runs in a day."
    : draft.type === "cycle" ? "The window it cycles within (on→off). Add more for split windows."
    : "Add each on→off block.";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Add / change form */}
      <section className="sa-panel" style={{ padding: 0 }}>
        <div className="sa-panel-hd sa-panel-hd--production">{editing ? `Editing “${draft.name || "schedule"}”` : "Add a schedule"}</div>
        <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
            <Field label="Name (pick or type)">
              <input list="sched-names" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} style={inputStyle} placeholder="e.g. Feeder run, Lights" />
              <datalist id="sched-names">{nameOptions.map((n) => <option key={n} value={n} />)}</datalist>
            </Field>
            <Field label="House"><HouseSelect value={draft.house} onChange={(v) => setDraft({ ...draft, house: v })} style={inputStyle} /></Field>
            <Field label="Start date" hint="The day this version starts running. Earlier ones become history.">
              <input type="date" value={draft.effectiveDate} onChange={(e) => setDraft({ ...draft, effectiveDate: e.target.value })} style={inputStyle} />
            </Field>
            <Field label="Type">
              <select value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value as ActionType })} style={inputStyle}>
                <option value="do">Runs at a time (e.g. feeder)</option>
                <option value="onoff">On / off block (e.g. lights)</option>
                <option value="cycle">On/off cycle in a window (e.g. fans)</option>
              </select>
            </Field>
          </div>

          {/* Multiple times — this is the whole set the schedule runs at. */}
          <Field label={timeLabel} hint={timeHint}>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {draft.times.map((t, i) => (
                <div key={i} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <input type="time" value={t.start} onChange={(e) => setTime(i, { start: e.target.value })} style={{ ...inputStyle, maxWidth: 150 }} />
                  {draft.type !== "do" && <>
                    <span style={{ color: "var(--t3)", fontWeight: 700 }}>→</span>
                    <input type="time" value={t.end} onChange={(e) => setTime(i, { end: e.target.value })} style={{ ...inputStyle, maxWidth: 150 }} />
                  </>}
                  {draft.times.length > 1 && (
                    <button type="button" onClick={() => removeTime(i)} aria-label="Remove"
                      style={{ border: "1px solid rgba(0,0,0,0.14)", background: "#fff", color: "var(--danger)", width: 34, height: 34, fontSize: 18, lineHeight: 1, cursor: "pointer", flexShrink: 0 }}>×</button>
                  )}
                </div>
              ))}
              <button type="button" onClick={addTime} style={{ alignSelf: "flex-start", background: "transparent", border: "1px dashed var(--teal)", color: "var(--teal)", padding: "7px 14px", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>{draft.type === "do" ? "+ Add time" : "+ Add window"}</button>
            </div>
          </Field>

          {draft.type === "cycle" && (
            <Field label="Cycle within the window" hint="e.g. runs 5 min every 30 min.">
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <span style={{ fontSize: 13, color: "var(--t2)" }}>Runs for</span>
                <input type="number" min={1} value={draft.runMinutes} onChange={(e) => setDraft({ ...draft, runMinutes: Number(e.target.value) })} style={{ ...inputStyle, maxWidth: 90 }} />
                <span style={{ fontSize: 13, color: "var(--t2)" }}>min, every</span>
                <input type="number" min={1} value={draft.everyMinutes} onChange={(e) => setDraft({ ...draft, everyMinutes: Number(e.target.value) })} style={{ ...inputStyle, maxWidth: 90 }} />
                <span style={{ fontSize: 13, color: "var(--t2)" }}>min</span>
              </div>
            </Field>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
            <Field label="Repeats">
              <select value={draft.recurrence} onChange={(e) => setDraft({ ...draft, recurrence: e.target.value as Recurrence })} style={inputStyle}>
                <option value="daily">Daily</option>
                <option value="hourly">Every N hours</option>
                <option value="weekly">Weekly (pick days)</option>
                <option value="everyNDays">Every N days</option>
                <option value="biweekly">Biweekly (pick days)</option>
                <option value="monthly">Monthly (day of month)</option>
              </select>
            </Field>
            {(draft.recurrence === "everyNDays" || draft.recurrence === "hourly") && (
              <Field label={draft.recurrence === "hourly" ? "Every N hours" : "Every N days"}>
                <input type="number" min={1} value={draft.interval} onChange={(e) => setDraft({ ...draft, interval: Number(e.target.value) })} style={inputStyle} />
              </Field>
            )}
            {draft.recurrence === "monthly" && <Field label="Day of month"><input type="number" min={1} max={31} value={draft.dayOfMonth} onChange={(e) => setDraft({ ...draft, dayOfMonth: Number(e.target.value) })} style={inputStyle} /></Field>}
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

          <Field label="Notes"><input value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} style={inputStyle} placeholder="Optional" /></Field>

          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <button onClick={save} disabled={status.kind === "saving"}
              style={{ background: "var(--primary)", color: "#fff", border: "none", padding: "11px 22px", fontSize: 14, fontWeight: 700, cursor: "pointer", opacity: status.kind === "saving" ? 0.6 : 1 }}>
              {status.kind === "saving" ? "Saving…" : editing ? "Save" : "Add schedule"}
            </button>
            {editing && <button onClick={reset} style={{ background: "transparent", border: "none", color: "var(--t3)", fontWeight: 700, cursor: "pointer" }}>Cancel</button>}
            {status.kind === "ok" && <span style={{ color: "var(--ok)", fontSize: 13, fontWeight: 600 }}>{status.msg}</span>}
            {status.kind === "error" && <span style={{ color: "var(--danger)", fontSize: 13, fontWeight: 600 }}>{status.msg}</span>}
          </div>
        </div>
      </section>

      {/* One card per schedule: current set of times, with change history tucked under it. */}
      <section className="sa-panel" style={{ padding: 0 }}>
        <div className="sa-panel-hd sa-panel-hd--welfare">Schedules</div>
        <div style={{ padding: 12 }}>
          {schedules.length === 0 ? (
            <div style={{ padding: "20px 12px", color: "var(--t3)" }}>No schedules yet — add one above.</div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12, alignItems: "start" }}>
              {schedules.map((s) => {
                const open = openHistory.has(s.key);
                return (
                  <div key={s.key} style={{ border: "1px solid var(--divider)", display: "flex", flexDirection: "column", background: "var(--card)" }}>
                    {/* Header */}
                    <div style={{ padding: 10, borderBottom: "1px solid var(--divider)", background: "var(--card-alt)", display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ width: 11, height: 11, background: colorFor(s.name), flexShrink: 0 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 800, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.name}</div>
                        <div style={{ fontSize: 10.5, color: "var(--t3)" }}>{houseLabel(s.house)}</div>
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 3, alignItems: "flex-end", flexShrink: 0 }}>
                        <button onClick={() => change(s.current)} style={linkBtn("var(--teal)")}>Change</button>
                        <button onClick={() => delSchedule(s)} style={linkBtn("var(--danger)")}>Delete</button>
                      </div>
                    </div>

                    {/* Current version — the live set of times, shown together. */}
                    <div style={{ padding: "10px 12px" }}>
                      <div style={{ fontSize: 9.5, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--teal)" }}>Now · since {s.current.effectiveDate}</div>
                      <div style={{ fontSize: 15, fontWeight: 700, marginTop: 3 }}>{timesSummary(s.current)}</div>
                      {cycleSummary(s.current) && <div style={{ fontSize: 12.5, fontWeight: 600, marginTop: 1 }}>{cycleSummary(s.current)}</div>}
                      <div style={{ fontSize: 12, color: "var(--t2)", marginTop: 2 }}>{recurrenceSummary(s.current)}</div>
                      {s.current.notes && <div style={{ fontSize: 11.5, color: "var(--t3)", marginTop: 3 }}>{s.current.notes}</div>}
                      <div style={{ marginTop: 6 }}><button onClick={() => edit(s.current)} style={{ ...linkBtn("var(--teal)"), fontSize: 11 }}>Edit</button></div>
                    </div>

                    {/* History — past sets of times, so the farmer sees how it changed. */}
                    {s.history.length > 0 && (
                      <div style={{ borderTop: "1px solid var(--divider)" }}>
                        <button onClick={() => toggleHistory(s.key)}
                          style={{ width: "100%", textAlign: "left", background: "transparent", border: "none", cursor: "pointer", padding: "8px 12px", fontSize: 11, fontWeight: 700, color: "var(--t2)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <span>History ({s.history.length})</span>
                          <span style={{ color: "var(--t3)" }}>{open ? "▾" : "▸"}</span>
                        </button>
                        {open && s.history.map((v) => (
                          <div key={v.effectiveDate + v.changedAt} style={{ padding: "6px 12px 8px", borderTop: "1px solid var(--divider)" }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 6 }}>
                              <span style={{ fontSize: 11, fontWeight: 700, color: "var(--t3)" }}>{v.effectiveDate}</span>
                              <button onClick={() => delVersion(v)} style={{ ...linkBtn("var(--danger)"), fontSize: 10.5 }}>Remove</button>
                            </div>
                            <div style={{ fontSize: 12.5, color: "var(--t2)" }}>{timesSummary(v)}{cycleSummary(v) ? ` · ${cycleSummary(v)}` : ""}</div>
                            <div style={{ fontSize: 10.5, color: "var(--t3)" }}>{recurrenceSummary(v)}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
