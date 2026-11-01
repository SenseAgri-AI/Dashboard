"use client";

import { useCallback, useEffect, useState } from "react";
import ListEmptyRow, { type LoadState } from "./ListEmptyRow";
import { deliveryWarning, intakeBetweenDeliveries, parseFeedWeightKg, LAYER_INTAKE_G } from "@/lib/feedSanity";
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
  const [hens, setHens] = useState(0);
  const [f, setF] = useState<FeedDelivery>(empty());
  const [status, setStatus] = useState<{ kind: "idle" | "saving" | "ok" | "error"; msg?: string }>({ kind: "idle" });

  // As a farmer, when the list fails to load I want to be told, not shown "No deliveries logged yet",
  // so I don't log the same delivery twice.
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/feed");
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      setRows(data.deliveries ?? []);
      setHens(Number(data.totalHens) || 0);
      setLoadState("ok");
    } catch {
      setLoadState("error");
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const set = (k: keyof FeedDelivery) => (e: React.ChangeEvent<HTMLInputElement>) => setF((x) => ({ ...x, [k]: e.target.value }));

  // As a farmer logging a delivery, I want a typo or a bag count caught before it is saved,
  // so the "how long did it last" figures below stay trustworthy.
  const weightWarning = hens > 0 ? deliveryWarning(f.weight, hens) : null;
  // As a farmer, I want to see how long each delivery lasted in g/hen/day (layers eat about
  // 100–125 g), so I notice birds eating less, feed wastage, or a delivery I forgot to log.
  const intakeByDate = new Map(hens > 0 ? intakeBetweenDeliveries(rows, hens).map((x) => [x.date, x]) : []);

  // Load an existing delivery into the form for editing (keeps its id → save updates it).
  function edit(d: FeedDelivery) {
    setF({ ...d });
    setStatus({ kind: "idle" });
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function save() {
    setStatus({ kind: "saving" });
    const editing = !!f.id;
    const res = await fetch("/api/feed", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(f) });
    const data = await res.json();
    if (!res.ok) { setStatus({ kind: "error", msg: data.error ?? "Failed" }); return; }
    setStatus({ kind: "ok", msg: editing ? "Delivery updated" : "Delivery logged" });
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
        <div className="sa-panel-hd sa-panel-hd--financial">{f.id ? "Edit feed delivery" : "Log a feed delivery / silo fill"}</div>
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
              <Field label="Weight filled (kg)">
                <input value={f.weight} onChange={set("weight")} style={inputStyle} placeholder="e.g. 25 000 kg" />
                {weightWarning && <span style={{ fontSize: 11, color: "var(--warn, #B45309)", fontWeight: 600 }}>{weightWarning}</span>}
              </Field>
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
              style={{ background: "var(--grad-primary)", color: "#fff", border: "none", boxShadow: "var(--shadow-primary)", padding: "11px 22px", fontSize: 14, fontWeight: 700, cursor: "pointer", opacity: status.kind === "saving" ? 0.6 : 1 }}>
              {status.kind === "saving" ? "Saving…" : f.id ? "Save changes" : "Log delivery"}
            </button>
            {f.id && <button onClick={() => setF(empty())} style={{ background: "transparent", border: "none", color: "var(--t3)", fontWeight: 700, cursor: "pointer" }}>Cancel</button>}
            {status.kind === "ok" && <span style={{ color: "var(--ok)", fontSize: 13, fontWeight: 600 }}>{status.msg}</span>}
            {status.kind === "error" && <span style={{ color: "var(--danger)", fontSize: 13, fontWeight: 600 }}>{status.msg}</span>}
          </div>
        </div>
      </section>

      <section className="sa-panel" style={{ padding: 0 }}>
        <div className="sa-panel-hd sa-panel-hd--welfare">Recent deliveries</div>
        <div style={{ padding: "6px 12px 0", fontSize: 11, color: "var(--t3)" }}>&ldquo;Lasted&rdquo; is whole-farm: days until the next logged delivery (any silo), per housed hen. A rough guide, not per silo.</div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, minWidth: 860 }}>
            <thead>
              <tr style={{ textAlign: "left", color: "var(--t2)" }}>
                {/* Date, weight and "lasted" first: on a phone they're what fits without scrolling. */}
                {["Date", "Weight", "Lasted", "House", "Silo", "Feed type", "Batch", "Protein", "Calcium", "Phos", "Energy", ""].map((h) => (
                  <th key={h} style={{ padding: "8px 10px", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.05em", borderBottom: "1px solid var(--divider)" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {recent.map((d) => (
                <tr key={d.id} style={{ borderBottom: "1px solid var(--divider)" }}>
                  <td style={{ padding: "8px 10px", whiteSpace: "nowrap" }}>{d.date}</td>
                  <td style={{ padding: "8px 10px", whiteSpace: "nowrap" }}>{weightCell(d.weight)}</td>
                  <td style={{ padding: "8px 10px", whiteSpace: "nowrap" }}>{lastedCell(intakeByDate.get(d.date))}</td>
                  <td style={{ padding: "8px 10px", color: "var(--t2)" }}>{houseLabel(d.house)}</td>
                  <td style={{ padding: "8px 10px", fontWeight: 700 }}>{d.silo}</td>
                  <td style={{ padding: "8px 10px" }}>{d.feedType}</td>
                  <td style={{ padding: "8px 10px", fontFamily: "ui-monospace, monospace" }}>{d.batch}</td>
                  <td style={{ padding: "8px 10px" }}>{d.protein}</td>
                  <td style={{ padding: "8px 10px" }}>{d.calcium}</td>
                  <td style={{ padding: "8px 10px" }}>{d.phosphorus}</td>
                  <td style={{ padding: "8px 10px" }}>{d.energy}</td>
                  <td style={{ padding: "8px 10px", textAlign: "right", whiteSpace: "nowrap" }}>
                    <button onClick={() => edit(d)} style={{ background: "transparent", border: "none", color: "var(--teal)", fontWeight: 700, cursor: "pointer", marginRight: 12 }}>Edit</button>
                    <button onClick={() => remove(d)} style={{ background: "transparent", border: "none", color: "var(--danger)", fontWeight: 700, cursor: "pointer" }}>Delete</button>
                  </td>
                </tr>
              ))}
              {recent.length === 0 && <ListEmptyRow state={loadState} colSpan={12} what="deliveries" empty="No deliveries logged yet." onRetry={() => { setLoadState("loading"); load(); }} />}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function weightCell(text: string) {
  const p = parseFeedWeightKg(text);
  if (p.kg != null && p.issue == null) return `${Math.round(p.kg).toLocaleString("en-ZA")} kg`;
  if (!text) return "";
  return <span title="Weight should be in kg, e.g. 25 000 kg">{text} <span style={{ color: "var(--warn, #B45309)", fontWeight: 700 }}>unit?</span></span>;
}

function lastedCell(x: ReturnType<typeof intakeBetweenDeliveries>[number] | undefined) {
  if (!x) return <span style={{ color: "var(--t3)" }}>–</span>;
  if (x.verdict === "looks-wrong") {
    return <span style={{ color: "var(--warn, #B45309)", fontWeight: 700 }} title="Outside 70–160 g/hen/day: usually a delivery that wasn't logged, or a weight typo">{x.days} days · looks wrong</span>;
  }
  const colour = x.verdict === "normal" ? "var(--t1)" : "var(--warn, #B45309)";
  const note = x.verdict === "low" ? ` (below ${LAYER_INTAKE_G.min} g)` : x.verdict === "high" ? ` (above ${LAYER_INTAKE_G.max} g)` : "";
  return <span style={{ color: colour }}>{x.days} days · {x.gPerHenDay} g/hen/day{note}</span>;
}
