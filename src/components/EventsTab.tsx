"use client";

import { useCallback, useEffect, useState } from "react";
import HouseSelect, { houseLabel } from "@/components/HouseSelect";

type FarmEvent = { id: string; date: string; time: string; type: string; title: string; details: string; notes: string; loggedBy: string; house: string };

type PresetField = { k: string; label: string; placeholder?: string };
const EVENT_TYPES: { key: string; label: string; color: string; fields: PresetField[] }[] = [
  { key: "vaccination", label: "Vaccination", color: "#2A8E9A", fields: [
    { k: "Vaccine", label: "Vaccine" }, { k: "Dose", label: "Dose" }, { k: "Route", label: "Route", placeholder: "drinking water / spray / injection" }, { k: "Batch", label: "Batch / lot no." }, { k: "Bird age", label: "Bird age" } ] },
  { key: "medication", label: "Medication / treatment", color: "#B91C1C", fields: [
    { k: "Drug", label: "Drug" }, { k: "Dose", label: "Dose & concentration" }, { k: "Withdrawal", label: "Withdrawal period" }, { k: "Reason", label: "Reason" } ] },
  { key: "water_treatment", label: "Water treatment / additive", color: "#2A8E9A", fields: [
    { k: "Additive", label: "Additive" }, { k: "Dose", label: "Dose / concentration" }, { k: "Reason", label: "Reason" } ] },
  { key: "health_obs", label: "Health / disease observation", color: "#92400E", fields: [
    { k: "Sign", label: "Sign / diagnosis" }, { k: "Birds affected", label: "Birds affected" }, { k: "Severity", label: "Severity" } ] },
  { key: "equipment", label: "Equipment / maintenance", color: "#3F4849", fields: [
    { k: "Item", label: "Item" }, { k: "Issue", label: "Issue" }, { k: "Action", label: "Action taken" } ] },
  { key: "environmental", label: "Environmental intervention", color: "#002E35", fields: [
    { k: "What changed", label: "What changed" }, { k: "New setting", label: "New setting" } ] },
  { key: "other", label: "Other", color: "#6B7C80", fields: [] },
];
const typeMeta = (key: string) => EVENT_TYPES.find((t) => t.key === key) ?? EVENT_TYPES[EVENT_TYPES.length - 1];

const todayInSast = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Johannesburg" }).format(new Date());

const inputStyle: React.CSSProperties = {
  border: "1px solid rgba(0,0,0,0.14)", background: "#fff", color: "var(--t1)",
  padding: "9px 11px", fontSize: 14, fontFamily: "var(--font-s)", width: "100%", outline: "none",
};
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--t2)" }}>{label}</span>
      {children}
    </label>
  );
}

export default function EventsTab() {
  const [events, setEvents] = useState<FarmEvent[]>([]);
  const [type, setType] = useState("vaccination");
  const [house, setHouse] = useState("");
  const [date, setDate] = useState(todayInSast());
  const [time, setTime] = useState("");
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [fieldVals, setFieldVals] = useState<Record<string, string>>({});
  const [editingId, setEditingId] = useState("");
  const [status, setStatus] = useState<{ kind: "idle" | "saving" | "ok" | "error"; msg?: string }>({ kind: "idle" });

  const load = useCallback(async () => {
    const res = await fetch("/api/events");
    if (res.ok) setEvents((await res.json()).events ?? []);
  }, []);
  useEffect(() => { load(); }, [load]);

  const meta = typeMeta(type);

  function reset() {
    setTitle(""); setNotes(""); setTime(""); setFieldVals({}); setDate(todayInSast()); setEditingId("");
  }

  // Load an existing event back into the form for editing (details string → field values).
  function edit(e: FarmEvent) {
    setType(e.type); setHouse(e.house); setDate(e.date); setTime(e.time);
    setTitle(e.title); setNotes(e.notes);
    const fv: Record<string, string> = {};
    for (const part of (e.details || "").split(";")) {
      const i = part.indexOf(":");
      if (i > 0) { const k = part.slice(0, i).trim(); if (k) fv[k] = part.slice(i + 1).trim(); }
    }
    setFieldVals(fv);
    setEditingId(e.id);
    setStatus({ kind: "idle" });
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function save() {
    setStatus({ kind: "saving" });
    const details = meta.fields
      .map((f) => [f.k, (fieldVals[f.k] ?? "").trim()])
      .filter(([, v]) => v)
      .map(([k, v]) => `${k}: ${v}`)
      .join("; ");
    const res = await fetch("/api/events", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: editingId || undefined, type, house, date, time, title: title.trim() || meta.label, details, notes }),
    });
    const data = await res.json();
    if (!res.ok) { setStatus({ kind: "error", msg: data.error ?? "Failed" }); return; }
    setStatus({ kind: "ok", msg: editingId ? "Event updated" : "Event logged" });
    reset();
    load();
  }

  async function remove(e: FarmEvent) {
    if (!confirm(`Delete "${e.title}" on ${e.date}?`)) return;
    await fetch(`/api/events?id=${encodeURIComponent(e.id)}`, { method: "DELETE" });
    load();
  }

  const recent = [...events].sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time)).slice(0, 20);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Log an event */}
      <section className="sa-panel" style={{ padding: 0 }}>
        <div className="sa-panel-hd sa-panel-hd--production">{editingId ? "Edit event" : "Log an event"}</div>
        <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
            <Field label="Type">
              <select value={type} onChange={(e) => { setType(e.target.value); setFieldVals({}); }} style={inputStyle}>
                {EVENT_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
              </select>
            </Field>
            <Field label="House"><HouseSelect value={house} onChange={setHouse} style={inputStyle} /></Field>
            <Field label="Date"><input type="date" value={date} max={todayInSast()} onChange={(e) => setDate(e.target.value)} style={inputStyle} /></Field>
            <Field label="Time (optional)"><input type="time" value={time} onChange={(e) => setTime(e.target.value)} style={inputStyle} /></Field>
          </div>

          {meta.fields.length > 0 && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10 }}>
              {meta.fields.map((f) => (
                <Field key={f.k} label={f.label}>
                  <input value={fieldVals[f.k] ?? ""} onChange={(e) => setFieldVals((v) => ({ ...v, [f.k]: e.target.value }))} style={inputStyle} placeholder={f.placeholder} />
                </Field>
              ))}
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 12 }}>
            <Field label="Title (optional)"><input value={title} onChange={(e) => setTitle(e.target.value)} style={inputStyle} placeholder={meta.label} /></Field>
            <Field label="Notes"><input value={notes} onChange={(e) => setNotes(e.target.value)} style={inputStyle} placeholder="Optional" /></Field>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <button onClick={save} disabled={status.kind === "saving"}
              style={{ background: "var(--grad-primary)", color: "#fff", border: "none", boxShadow: "var(--shadow-primary)", padding: "11px 22px", fontSize: 14, fontWeight: 700, cursor: "pointer", opacity: status.kind === "saving" ? 0.6 : 1 }}>
              {status.kind === "saving" ? "Saving…" : editingId ? "Save changes" : "Log event"}
            </button>
            {editingId && <button onClick={reset} style={{ background: "transparent", border: "none", color: "var(--t3)", fontWeight: 700, cursor: "pointer" }}>Cancel</button>}
            {status.kind === "ok" && <span style={{ color: "var(--ok)", fontSize: 13, fontWeight: 600 }}>{status.msg}</span>}
            {status.kind === "error" && <span style={{ color: "var(--danger)", fontSize: 13, fontWeight: 600 }}>{status.msg}</span>}
          </div>
        </div>
      </section>

      {/* Recent events */}
      <section className="sa-panel" style={{ padding: 0 }}>
        <div className="sa-panel-hd sa-panel-hd--welfare">Recent events</div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 640 }}>
            <thead>
              <tr style={{ textAlign: "left", color: "var(--t2)" }}>
                {["Date", "House", "Type", "Title", "Details", ""].map((h) => (
                  <th key={h} style={{ padding: "9px 12px", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em", borderBottom: "1px solid var(--divider)" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {recent.map((e) => {
                const m = typeMeta(e.type);
                return (
                  <tr key={e.id} style={{ borderBottom: "1px solid var(--divider)" }}>
                    <td style={{ padding: "9px 12px", whiteSpace: "nowrap" }}>{e.date}{e.time ? ` ${e.time}` : ""}</td>
                    <td style={{ padding: "9px 12px", color: "var(--t2)" }}>{houseLabel(e.house)}</td>
                    <td style={{ padding: "9px 12px" }}>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                        <span style={{ width: 8, height: 8, background: m.color }} />{m.label}
                      </span>
                    </td>
                    <td style={{ padding: "9px 12px", fontWeight: 600 }}>{e.title}</td>
                    <td style={{ padding: "9px 12px", color: "var(--t2)" }}>{e.details}{e.notes ? ` — ${e.notes}` : ""}</td>
                    <td style={{ padding: "9px 12px", textAlign: "right", whiteSpace: "nowrap" }}>
                      <button onClick={() => edit(e)} style={{ background: "transparent", border: "none", color: "var(--teal)", fontWeight: 700, cursor: "pointer", marginRight: 12 }}>Edit</button>
                      <button onClick={() => remove(e)} style={{ background: "transparent", border: "none", color: "var(--danger)", fontWeight: 700, cursor: "pointer" }}>Delete</button>
                    </td>
                  </tr>
                );
              })}
              {recent.length === 0 && <tr><td colSpan={6} style={{ padding: "20px 12px", color: "var(--t3)", textAlign: "center" }}>No events logged yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
