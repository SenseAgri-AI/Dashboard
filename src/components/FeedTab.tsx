"use client";

import { useCallback, useEffect, useState } from "react";
import HouseSelect, { houseLabel } from "@/components/HouseSelect";

type FeedDelivery = {
  id: string; date: string; time: string; silo: string; feedType: string; batch: string;
  supplier: string; weight: string; protein: string; calcium: string; phosphorus: string;
  energy: string; fat: string; fibre: string; sodium: string; cost: string; notes: string; loggedBy: string; house: string;
};

const todayInSast = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Johannesburg" }).format(new Date());
const empty = (): FeedDelivery => ({
  id: "", date: todayInSast(), time: "", silo: "", feedType: "", batch: "", supplier: "", weight: "",
  protein: "", calcium: "", phosphorus: "", energy: "", fat: "", fibre: "", sodium: "", cost: "", notes: "", loggedBy: "", house: "",
});

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
const grid = (min: number): React.CSSProperties => ({ display: "grid", gridTemplateColumns: `repeat(auto-fit, minmax(${min}px, 1fr))`, gap: 10 });

export default function FeedTab() {
  const [rows, setRows] = useState<FeedDelivery[]>([]);
  const [f, setF] = useState<FeedDelivery>(empty());
  const [status, setStatus] = useState<{ kind: "idle" | "saving" | "ok" | "error"; msg?: string }>({ kind: "idle" });

  const load = useCallback(async () => {
    const res = await fetch("/api/feed");
    if (res.ok) setRows((await res.json()).deliveries ?? []);
  }, []);
  useEffect(() => { load(); }, [load]);

  const set = (k: keyof FeedDelivery) => (e: React.ChangeEvent<HTMLInputElement>) => setF((x) => ({ ...x, [k]: e.target.value }));

  async function save() {
    setStatus({ kind: "saving" });
    const res = await fetch("/api/feed", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(f) });
    const data = await res.json();
    if (!res.ok) { setStatus({ kind: "error", msg: data.error ?? "Failed" }); return; }
    setStatus({ kind: "ok", msg: "Delivery logged" });
    setF(empty());
    load();
  }
  async function remove(d: FeedDelivery) {
    if (!confirm(`Delete the ${d.date} delivery to ${d.silo}?`)) return;
    await fetch(`/api/feed?id=${encodeURIComponent(d.id)}`, { method: "DELETE" });
    load();
  }

  const recent = [...rows].sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time)).slice(0, 20);
  const nutrientCols: [keyof FeedDelivery, string][] = [
    ["protein", "Crude protein %"], ["calcium", "Calcium %"], ["phosphorus", "Phosphorus %"],
    ["energy", "Energy (ME, MJ/kg)"], ["fat", "Fat %"], ["fibre", "Fibre %"], ["sodium", "Sodium %"],
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <section className="sa-panel" style={{ padding: 0 }}>
        <div className="sa-panel-hd sa-panel-hd--financial">Log a feed delivery / silo fill</div>
        <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 16 }}>

          <div>
            <div style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--primary)", marginBottom: 8 }}>Delivery</div>
            <div style={grid(150)}>
              <Field label="Silo *">
                <input list="silos" value={f.silo} onChange={set("silo")} style={inputStyle} placeholder="Silo 1 / 2 / 3" />
                <datalist id="silos"><option value="Silo 1" /><option value="Silo 2" /><option value="Silo 3" /></datalist>
              </Field>
              <Field label="House"><HouseSelect value={f.house} onChange={(v) => setF((x) => ({ ...x, house: v }))} style={inputStyle} /></Field>
              <Field label="Feed type / formulation"><input value={f.feedType} onChange={set("feedType")} style={inputStyle} placeholder="Layer mash phase 2" /></Field>
              <Field label="Batch no."><input value={f.batch} onChange={set("batch")} style={inputStyle} placeholder="for batch tracing" /></Field>
              <Field label="Supplier"><input value={f.supplier} onChange={set("supplier")} style={inputStyle} /></Field>
              <Field label="Weight filled"><input value={f.weight} onChange={set("weight")} style={inputStyle} placeholder="e.g. 5000 kg" /></Field>
              <Field label="Date *"><input type="date" value={f.date} max={todayInSast()} onChange={set("date")} style={inputStyle} /></Field>
              <Field label="Time"><input type="time" value={f.time} onChange={set("time")} style={inputStyle} /></Field>
            </div>
          </div>

          <div>
            <div style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--teal)", marginBottom: 8 }}>Nutrient spec (this batch)</div>
            <div style={grid(120)}>
              {nutrientCols.map(([k, label]) => (
                <Field key={k} label={label}><input value={f[k]} onChange={set(k)} style={inputStyle} inputMode="decimal" /></Field>
              ))}
              <Field label="Cost"><input value={f.cost} onChange={set("cost")} style={inputStyle} /></Field>
            </div>
          </div>

          <Field label="Notes"><input value={f.notes} onChange={set("notes")} style={inputStyle} placeholder="Optional" /></Field>

          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <button onClick={save} disabled={status.kind === "saving"}
              style={{ background: "var(--primary)", color: "#fff", border: "none", padding: "11px 22px", fontSize: 14, fontWeight: 700, cursor: "pointer", opacity: status.kind === "saving" ? 0.6 : 1 }}>
              {status.kind === "saving" ? "Saving…" : "Log delivery"}
            </button>
            {status.kind === "ok" && <span style={{ color: "var(--ok)", fontSize: 13, fontWeight: 600 }}>{status.msg}</span>}
            {status.kind === "error" && <span style={{ color: "var(--danger)", fontSize: 13, fontWeight: 600 }}>{status.msg}</span>}
          </div>
        </div>
      </section>

      <section className="sa-panel" style={{ padding: 0 }}>
        <div className="sa-panel-hd sa-panel-hd--welfare">Recent deliveries</div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, minWidth: 860 }}>
            <thead>
              <tr style={{ textAlign: "left", color: "var(--t2)" }}>
                {["Date", "House", "Silo", "Feed type", "Batch", "Weight", "Protein", "Calcium", "Phos", "Energy", ""].map((h) => (
                  <th key={h} style={{ padding: "8px 10px", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.05em", borderBottom: "1px solid var(--divider)" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {recent.map((d) => (
                <tr key={d.id} style={{ borderBottom: "1px solid var(--divider)" }}>
                  <td style={{ padding: "8px 10px", whiteSpace: "nowrap" }}>{d.date}</td>
                  <td style={{ padding: "8px 10px", color: "var(--t2)" }}>{houseLabel(d.house)}</td>
                  <td style={{ padding: "8px 10px", fontWeight: 700 }}>{d.silo}</td>
                  <td style={{ padding: "8px 10px" }}>{d.feedType}</td>
                  <td style={{ padding: "8px 10px", fontFamily: "ui-monospace, monospace" }}>{d.batch}</td>
                  <td style={{ padding: "8px 10px" }}>{d.weight}</td>
                  <td style={{ padding: "8px 10px" }}>{d.protein}</td>
                  <td style={{ padding: "8px 10px" }}>{d.calcium}</td>
                  <td style={{ padding: "8px 10px" }}>{d.phosphorus}</td>
                  <td style={{ padding: "8px 10px" }}>{d.energy}</td>
                  <td style={{ padding: "8px 10px", textAlign: "right" }}>
                    <button onClick={() => remove(d)} style={{ background: "transparent", border: "none", color: "var(--danger)", fontWeight: 700, cursor: "pointer" }}>Delete</button>
                  </td>
                </tr>
              ))}
              {recent.length === 0 && <tr><td colSpan={11} style={{ padding: "20px 12px", color: "var(--t3)", textAlign: "center" }}>No deliveries logged yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
