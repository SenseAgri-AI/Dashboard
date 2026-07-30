"use client";

import { useCallback, useEffect, useState } from "react";
import DashStatusBar from "@/components/DashStatusBar";
import HouseHdepChart from "@/components/HouseHdepChart";
import { buildAttention, type AttentionAlert } from "@/lib/attention";

type House = { id: string; name: string; startDate: string; startAgeDays: number; startingHens: number };
type Production = {
  date: string;
  eggs: { total: number };
  hdep: number | null;
  mortality: { cumulative: number; rate: number | null };
  totalHens: number;
} | null;
type Health = { health: number; word: string; label: "good" | "normal" | "warning" | "danger" } | null;

const todayInSast = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Johannesburg" }).format(new Date());

function flockWeeks(startDate: string, startAgeDays: number): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return null;
  const start = new Date(startDate + "T00:00:00").getTime();
  const days = startAgeDays + Math.floor((Date.now() - start) / 86_400_000);
  return Math.floor(days / 7);
}

// Responsive without CSS media queries (globals.css can go stale in dev). Renders desktop first,
// corrects on mount — no hydration mismatch.
function useIsNarrow(bp = 760): boolean {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${bp}px)`);
    const on = () => setNarrow(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [bp]);
  return narrow;
}

// Read-only status graphic (no user input): a solid colour box per sensing type.
const SENSING = [
  { key: "env", label: "Environment sensing", status: "on" },
  { key: "feed", label: "Feed sensing", status: "off" },
  { key: "water", label: "Water sensing", status: "off" },
  { key: "egg", label: "Egg sensing", status: "partial" },
] as const;
const SENSE_STATUS: Record<string, { color: string; text: string }> = {
  on: { color: "#16A34A", text: "Live" },
  off: { color: "#DC2626", text: "Off" },
  partial: { color: "#D97706", text: "Setup" },
};

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
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="sa-kpi-item">
      <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--t2)" }}>{label}</div>
      <div style={{ fontFamily: "var(--font-d)", fontSize: 22, fontWeight: 800, color: "var(--primary)" }}>{value}</div>
    </div>
  );
}

export default function HomePage() {
  const [houses, setHouses] = useState<House[]>([]);
  const [prod, setProd] = useState<Production>(null);
  const [health, setHealth] = useState<Health>(null);
  const [attention, setAttention] = useState<AttentionAlert[]>([]);
  const isNarrow = useIsNarrow();

  const loadHouses = useCallback(async () => {
    const res = await fetch("/api/houses");
    if (res.ok) setHouses((await res.json()).houses ?? []);
  }, []);

  useEffect(() => {
    loadHouses();
    fetch("/api/dashboard/summary")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d && !d.error) setHealth({ health: d.health, word: d.healthWord, label: d.healthLabel }); })
      .catch(() => {});
    fetch("/api/production")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const lastLogDate = d && !d.error ? (d.date ?? null) : null;
        if (d && !d.error) setProd(d);
        setAttention(buildAttention({ lastLogDate, now: Date.now() }));
      })
      .catch(() => setAttention(buildAttention({ lastLogDate: null, now: Date.now() })));
  }, [loadHouses]);

  return (
    <main className="sa-main" style={{ maxWidth: 1160, width: "100%", margin: "0 auto", gap: 12 }}>
      {/* Status band — health dial · sensing · attention */}
      <section style={{ display: "grid", gridTemplateColumns: isNarrow ? "1fr" : "200px minmax(0, 1fr) minmax(0, 1.2fr)", gap: 12, alignItems: "stretch" }}>
        <div style={{ display: "flex", ...(isNarrow ? { maxWidth: 260, width: "100%", margin: "0 auto" } : {}) }}>
          {health
            ? <DashStatusBar health={health.health} word={health.word} label={health.label} />
            : <div className="sa-gauge-card" style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: 150, width: "100%", color: "var(--t3)", fontSize: 12 }}>Loading…</div>}
        </div>
        <SensingCard />
        <AttentionCard alerts={attention} />
      </section>

      {/* Farm overview */}
      <section className="sa-panel" style={{ padding: 0 }}>
        <div className="sa-panel-hd sa-panel-hd--production">Farm overview</div>
        <div style={{ padding: 14, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 8 }}>
          <Stat label="Houses" value={String(houses.length)} />
          <Stat label="Live hens" value={prod ? prod.totalHens.toLocaleString() : "—"} />
          <Stat label={`Eggs (${prod?.date ?? "—"})`} value={prod ? prod.eggs.total.toLocaleString() : "—"} />
          <Stat label="Hen-day %" value={prod?.hdep != null ? `${prod.hdep}%` : "—"} />
          <Stat label="Mortality rate" value={prod?.mortality.rate != null ? `${prod.mortality.rate}%` : "—"} />
        </div>
      </section>

      {/* Houses — info + HDEP projection */}
      <section className="sa-panel" style={{ padding: 0 }}>
        <div className="sa-panel-hd sa-panel-hd--welfare">Houses</div>
        <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 12 }}>
          {houses.map((h) => <HouseCard key={h.id} house={h} narrow={isNarrow} />)}
          {houses.length === 0 && <div style={{ color: "var(--t3)", padding: 8 }}>No houses set up yet — add one below.</div>}
        </div>
      </section>

      {/* House management */}
      <HousesManager houses={houses} onSaved={loadHouses} />
    </main>
  );
}

function SensingCard() {
  return (
    <div className="sa-panel" style={{ padding: 0, display: "flex", flexDirection: "column" }}>
      <div className="sa-panel-hd sa-panel-hd--production">Sensing enabled</div>
      <div style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
        {SENSING.map((s) => {
          const st = SENSE_STATUS[s.status];
          return (
            <div key={s.key} style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ width: 15, height: 15, borderRadius: 3, background: st.color, flexShrink: 0 }} />
              <span style={{ fontSize: 13.5, fontWeight: 600, color: "var(--t1)" }}>{s.label}</span>
              <span style={{ marginLeft: "auto", fontSize: 10.5, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.04em", color: st.color }}>{st.text}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AttentionCard({ alerts }: { alerts: AttentionAlert[] }) {
  const color = (s: AttentionAlert["severity"]) => (s === "danger" ? "#B91C1C" : s === "warning" ? "#B45309" : "#0c5c69");
  return (
    <div className="sa-panel" style={{ padding: 0, display: "flex", flexDirection: "column" }}>
      <div className="sa-panel-hd sa-panel-hd--financial">Attention</div>
      <div style={{ padding: "12px", display: "flex", flexDirection: "column", gap: 8 }}>
        {alerts.length === 0 && <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ok)", padding: "4px 2px" }}>All good — nothing needs attention.</div>}
        {alerts.map((a) => (
          <div key={a.id} style={{ borderLeft: `3px solid ${color(a.severity)}`, background: "var(--card-alt)", padding: "8px 11px" }}>
            <div style={{ fontSize: 12.5, fontWeight: 800, color: color(a.severity) }}>{a.title}</div>
            <div style={{ fontSize: 12, color: "var(--t2)", marginTop: 2, lineHeight: 1.45 }}>{a.detail}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

const sub: React.CSSProperties = { fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--t3)" };
const val: React.CSSProperties = { fontFamily: "var(--font-d)", fontWeight: 800, fontSize: 16, color: "var(--primary)" };

function HouseCard({ house, narrow }: { house: House; narrow: boolean }) {
  const wks = flockWeeks(house.startDate, house.startAgeDays);
  return (
    <div style={{ display: "grid", gridTemplateColumns: narrow ? "1fr" : "minmax(190px, 240px) minmax(0, 1fr)", gap: 14, alignItems: "center", border: "1px solid var(--divider)", padding: 12 }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontFamily: "var(--font-d)", fontWeight: 800, fontSize: 16 }}>{house.name || house.id}</div>
        <div style={{ display: "flex", gap: 16, marginTop: 8 }}>
          <div><div style={sub}>Flock age</div><div style={val}>{wks != null ? `${wks} wks` : "—"}</div></div>
          <div><div style={sub}>Hens</div><div style={val}>{house.startingHens.toLocaleString()}</div></div>
        </div>
        <div style={{ ...sub, marginTop: 8 }}>Cycle start {house.startDate || "—"}</div>
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--t3)", marginBottom: 3 }}>
          Hen-day % vs breed standard
        </div>
        <HouseHdepChart house={house} height={narrow ? 132 : 150} />
      </div>
    </div>
  );
}

function HousesManager({ houses, onSaved }: { houses: House[]; onSaved: () => void }) {
  const [draft, setDraft] = useState<House>({ id: "", name: "", startDate: todayInSast(), startAgeDays: 133, startingHens: 0 });
  const [msg, setMsg] = useState("");

  async function save() {
    setMsg("");
    const res = await fetch("/api/houses", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(draft) });
    if (!res.ok) { const d = await res.json(); setMsg(d.error ?? "Failed"); return; }
    setMsg("Saved");
    setDraft({ id: "", name: "", startDate: todayInSast(), startAgeDays: 133, startingHens: 0 });
    onSaved();
  }

  return (
    <section className="sa-panel" style={{ padding: 0 }}>
      <div className="sa-panel-hd sa-panel-hd--financial">Set up / edit houses</div>
      <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
        {houses.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {houses.map((h) => (
              <button key={h.id} onClick={() => setDraft({ ...h })} style={{ border: "1px solid rgba(0,0,0,0.14)", background: "#fff", padding: "6px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                {h.name || h.id}
              </button>
            ))}
          </div>
        )}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10 }}>
          <Field label="House ID"><input value={draft.id} onChange={(e) => setDraft({ ...draft, id: e.target.value })} style={inputStyle} placeholder="house1" /></Field>
          <Field label="Name"><input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} style={inputStyle} /></Field>
          <Field label="Start date"><input type="date" value={draft.startDate} onChange={(e) => setDraft({ ...draft, startDate: e.target.value })} style={inputStyle} /></Field>
          <Field label="Start age (days)"><input type="number" min={0} value={draft.startAgeDays} onChange={(e) => setDraft({ ...draft, startAgeDays: Number(e.target.value) })} style={inputStyle} /></Field>
          <Field label="Starting hens"><input type="number" min={0} value={draft.startingHens} onChange={(e) => setDraft({ ...draft, startingHens: Number(e.target.value) })} style={inputStyle} /></Field>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button onClick={save} style={{ background: "var(--grad-primary)", color: "#fff", border: "none", boxShadow: "var(--shadow-primary)", padding: "10px 20px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>Save house</button>
          {msg && <span style={{ fontSize: 13, fontWeight: 600, color: msg === "Saved" ? "var(--ok)" : "var(--danger)" }}>{msg}</span>}
        </div>
      </div>
    </section>
  );
}
