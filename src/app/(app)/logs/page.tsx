"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type House = { id: string; name: string; startDate: string; startAgeDays: number; startingHens: number };
type Entry = {
  date: string; houseId: string;
  small: number; medium: number; large: number; xl: number; j: number;
  damaged: number; mortality: number; notes: string;
  avgEggWeightG: number | null; waterPh: number | null; eggYolkColor: number | null;
  avgHenWeightKg: number | null; waterIntakeMl: number | null; feedType: string; waterAdditives: string;
  rowNumber?: number;
};

const EGG_SIZES = ["small", "medium", "large", "xl", "j"] as const;
const SIZE_LABELS: Record<string, string> = { small: "Small", medium: "Medium", large: "Large", xl: "XL", j: "Jumbo" };

function todayInSast(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Johannesburg" }).format(new Date());
}

const emptyForm = (date: string, houseId: string): Entry => ({
  date, houseId, small: 0, medium: 0, large: 0, xl: 0, j: 0, damaged: 0, mortality: 0,
  notes: "", avgEggWeightG: null, waterPh: null, eggYolkColor: null, avgHenWeightKg: null,
  waterIntakeMl: null, feedType: "", waterAdditives: "",
});

// Small labelled number/text input
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--t2)" }}>{label}</span>
      {children}
    </label>
  );
}

const inputStyle: React.CSSProperties = {
  border: "1px solid rgba(0,0,0,0.14)", background: "#fff", color: "var(--t1)",
  padding: "9px 11px", fontSize: 14, fontFamily: "var(--font-s)", width: "100%", outline: "none",
};

export default function LogsPage() {
  const [houses, setHouses] = useState<House[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [houseId, setHouseId] = useState<string>("");
  const [date, setDate] = useState<string>(todayInSast());
  const [form, setForm] = useState<Entry>(emptyForm(todayInSast(), ""));
  const [showChecks, setShowChecks] = useState(false);
  const [sheetUrl, setSheetUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<{ kind: "idle" | "saving" | "ok" | "error"; msg?: string }>({ kind: "idle" });

  const loadHouses = useCallback(async () => {
    const res = await fetch("/api/houses");
    if (!res.ok) return;
    const data = await res.json();
    const hs: House[] = data.houses ?? [];
    setHouses(hs);
    setHouseId((prev) => prev || hs[0]?.id || "house1");
  }, []);

  const loadEntries = useCallback(async () => {
    const res = await fetch("/api/logs");
    if (!res.ok) return;
    const data = await res.json();
    setEntries(data.entries ?? []);
  }, []);

  useEffect(() => {
    loadHouses();
    loadEntries();
    fetch("/api/farm").then((r) => (r.ok ? r.json() : null)).then((d) => d && setSheetUrl(d.sheetUrl)).catch(() => {});
  }, [loadHouses, loadEntries]);

  // When date+house changes, prefill from an existing entry (duplicate-date → edit).
  const existing = useMemo(
    () => entries.find((e) => e.date === date && e.houseId === houseId),
    [entries, date, houseId]
  );
  useEffect(() => {
    if (!houseId) return;
    setForm(existing ? { ...existing } : emptyForm(date, houseId));
  }, [existing, date, houseId]);

  const totalEggs = EGG_SIZES.reduce((sum, k) => sum + (Number(form[k]) || 0), 0);

  const setNum = (k: keyof Entry) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value === "" ? 0 : Number(e.target.value) }));
  const setOpt = (k: keyof Entry) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value === "" ? null : Number(e.target.value) }));
  const setStr = (k: keyof Entry) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  async function save() {
    setStatus({ kind: "saving" });
    try {
      const res = await fetch("/api/logs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, date, houseId }),
      });
      if (!res.ok) {
        const d = await res.json();
        setStatus({ kind: "error", msg: d.error ?? "Failed to save" });
        return;
      }
      setStatus({ kind: "ok", msg: existing ? "Entry updated" : "Entry saved" });
      await loadEntries();
    } catch {
      setStatus({ kind: "error", msg: "Connection error" });
    }
  }

  async function remove(e: Entry) {
    if (!confirm(`Delete the ${e.date} entry for ${e.houseId}?`)) return;
    await fetch(`/api/logs?date=${e.date}&house=${encodeURIComponent(e.houseId)}`, { method: "DELETE" });
    await loadEntries();
  }

  const recent = [...entries].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 12);

  return (
    <main className="sa-main" style={{ maxWidth: 1100, width: "100%", margin: "0 auto" }}>
      {sheetUrl && (
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 4 }}>
          <a href={sheetUrl} target="_blank" rel="noopener noreferrer"
            style={{ fontSize: 12.5, fontWeight: 700, color: "var(--teal)", textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 5 }}>
            Open Google Sheet
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M7 17 17 7M8 7h9v9" />
            </svg>
          </a>
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 12 }}>

        {/* Entry card */}
        <section className="sa-panel" style={{ padding: 0 }}>
          <div className="sa-panel-hd sa-panel-hd--production">Daily Entry</div>
          <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <Field label="House">
                <select value={houseId} onChange={(e) => setHouseId(e.target.value)} style={inputStyle}>
                  {houses.length === 0 && <option value="house1">house1</option>}
                  {houses.map((h) => <option key={h.id} value={h.id}>{h.name || h.id}</option>)}
                </select>
              </Field>
              <Field label="Date">
                <input type="date" value={date} max={todayInSast()} onChange={(e) => setDate(e.target.value)} style={inputStyle} />
              </Field>
            </div>

            {existing && (
              <div style={{ fontSize: 12, fontWeight: 600, color: "var(--teal)" }}>
                Editing existing entry for {date} · {houseId}
              </div>
            )}

            {/* Egg counts */}
            <div>
              <div style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--primary)", marginBottom: 8 }}>
                Eggs collected — {totalEggs.toLocaleString()} total
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(90px, 1fr))", gap: 10 }}>
                {EGG_SIZES.map((k) => (
                  <Field key={k} label={SIZE_LABELS[k]}>
                    <input type="number" min={0} value={form[k] || ""} onChange={setNum(k)} style={inputStyle} placeholder="0" />
                  </Field>
                ))}
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <Field label="Damaged"><input type="number" min={0} value={form.damaged || ""} onChange={setNum("damaged")} style={inputStyle} placeholder="0" /></Field>
              <Field label="Mortality"><input type="number" min={0} value={form.mortality || ""} onChange={setNum("mortality")} style={inputStyle} placeholder="0" /></Field>
            </div>

            <Field label="Notes"><textarea value={form.notes} onChange={setStr("notes")} rows={2} style={{ ...inputStyle, resize: "vertical" }} placeholder="Optional notes…" /></Field>

            {/* Optional daily checks */}
            <button onClick={() => setShowChecks((v) => !v)} style={{ alignSelf: "flex-start", background: "transparent", border: "none", color: "var(--teal)", fontSize: 12, fontWeight: 700, cursor: "pointer", padding: 0 }}>
              {showChecks ? "− Hide" : "+ Add"} optional daily checks
            </button>
            {showChecks && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
                <Field label="Avg Egg Weight (g)"><input type="number" min={0} step="0.1" value={form.avgEggWeightG ?? ""} onChange={setOpt("avgEggWeightG")} style={inputStyle} /></Field>
                <Field label="Water pH"><input type="number" min={0} step="0.1" value={form.waterPh ?? ""} onChange={setOpt("waterPh")} style={inputStyle} /></Field>
                <Field label="Egg Yolk Color"><input type="number" min={0} value={form.eggYolkColor ?? ""} onChange={setOpt("eggYolkColor")} style={inputStyle} /></Field>
                <Field label="Avg Hen Weight (kg)"><input type="number" min={0} step="0.01" value={form.avgHenWeightKg ?? ""} onChange={setOpt("avgHenWeightKg")} style={inputStyle} /></Field>
                <Field label="Water Intake (ml)"><input type="number" min={0} value={form.waterIntakeMl ?? ""} onChange={setOpt("waterIntakeMl")} style={inputStyle} /></Field>
                <Field label="Feed Type"><input type="text" value={form.feedType} onChange={setStr("feedType")} style={inputStyle} /></Field>
                <Field label="Water Additives"><input type="text" value={form.waterAdditives} onChange={setStr("waterAdditives")} style={inputStyle} /></Field>
              </div>
            )}

            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <button
                onClick={save}
                disabled={status.kind === "saving"}
                style={{ background: "var(--teal)", color: "#fff", border: "none", padding: "11px 22px", fontSize: 14, fontWeight: 700, cursor: "pointer", opacity: status.kind === "saving" ? 0.6 : 1 }}
              >
                {status.kind === "saving" ? "Saving…" : existing ? "Update entry" : "Save entry"}
              </button>
              {status.kind === "ok" && <span style={{ color: "var(--ok)", fontSize: 13, fontWeight: 600 }}>{status.msg}</span>}
              {status.kind === "error" && <span style={{ color: "var(--danger)", fontSize: 13, fontWeight: 600 }}>{status.msg}</span>}
            </div>
          </div>
        </section>

        {/* Recent entries */}
        <section className="sa-panel" style={{ padding: 0 }}>
          <div className="sa-panel-hd sa-panel-hd--welfare">Recent Entries</div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: "left", color: "var(--t2)" }}>
                  {["Date", "House", "Eggs", "Damaged", "Mortality", ""].map((h) => (
                    <th key={h} style={{ padding: "9px 12px", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em", borderBottom: "1px solid var(--divider)" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {recent.map((e) => {
                  const eggs = EGG_SIZES.reduce((s, k) => s + (Number(e[k]) || 0), 0);
                  return (
                    <tr key={`${e.date}-${e.houseId}`} style={{ borderBottom: "1px solid var(--divider)" }}>
                      <td style={{ padding: "9px 12px" }}>{e.date}</td>
                      <td style={{ padding: "9px 12px" }}>{e.houseId}</td>
                      <td style={{ padding: "9px 12px", fontWeight: 700 }}>{eggs.toLocaleString()}</td>
                      <td style={{ padding: "9px 12px" }}>{e.damaged}</td>
                      <td style={{ padding: "9px 12px" }}>{e.mortality}</td>
                      <td style={{ padding: "9px 12px", textAlign: "right" }}>
                        <button onClick={() => { setDate(e.date); setHouseId(e.houseId); }} style={{ background: "transparent", border: "none", color: "var(--teal)", fontWeight: 700, cursor: "pointer", marginRight: 12 }}>Edit</button>
                        <button onClick={() => remove(e)} style={{ background: "transparent", border: "none", color: "var(--danger)", fontWeight: 700, cursor: "pointer" }}>Delete</button>
                      </td>
                    </tr>
                  );
                })}
                {recent.length === 0 && (
                  <tr><td colSpan={6} style={{ padding: "20px 12px", color: "var(--t3)", textAlign: "center" }}>No entries yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

      </div>
    </main>
  );
}
