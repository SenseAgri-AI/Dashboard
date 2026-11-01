"use client";

import { useCallback, useEffect, useState } from "react";
import PushNotifications from "@/components/PushNotifications";
import DashStatusBar from "@/components/DashStatusBar";
import HouseHdepChart from "@/components/HouseHdepChart";
import { buildAttention, type AttentionAlert } from "@/lib/attention"; // folded into the Today card
import TodayCard, { type TodayClimate } from "@/components/TodayCard";
import type { DailyRow } from "@/lib/todayStatus";

type House = { id: string; name: string; startDate: string; startAgeDays: number; startingHens: number };
type Production = {
  date: string;
  eggs: { total: number };
  hdep: number | null;
  mortality: { cumulative: number; rate: number | null };
  totalHens: number;
  daily?: DailyRow[];
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
  // Today card inputs: undefined = failed to load, so the card shows its footer instead of "All good".
  const [today, setToday] = useState<{ prod: boolean; env: boolean; daily?: DailyRow[]; lastLogDate?: string | null; climate?: TodayClimate }>({ prod: false, env: false });
  const isNarrow = useIsNarrow();

  const loadHouses = useCallback(async () => {
    const res = await fetch("/api/houses");
    if (res.ok) setHouses((await res.json()).houses ?? []);
  }, []);

  useEffect(() => {
    loadHouses();
    fetch("/api/dashboard/summary")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d && !d.error) {
          setHealth({ health: d.health, word: d.healthWord, label: d.healthLabel });
          setToday((t) => ({ ...t, env: true, climate: { temperatureC: d.env?.temperature?.current ?? null, humidityPct: d.env?.humidity?.current ?? null, co2Series: Array.isArray(d.env?.co2?.sparkline) ? d.env.co2.sparkline : [], tempSeries: Array.isArray(d.env?.temperature?.sparkline) ? d.env.temperature.sparkline : [] } }));
        } else setToday((t) => ({ ...t, env: true }));
      })
      .catch(() => setToday((t) => ({ ...t, env: true })));
    fetch("/api/production")
      .then((r) => (r.ok || r.status === 404 ? r.json().then((d) => ({ d, noData: r.status === 404 })) : { d: null, noData: false }))
      .then(({ d, noData }) => {
        const lastLogDate = d && !d.error ? (d.date ?? null) : null;
        if (d && !d.error) setProd(d);
        setAttention(buildAttention({ lastLogDate, now: Date.now() }));
        // 404 = the sheet has no entries (a real "no log yet"); other failures stay unknown.
        setToday((t) => ({ ...t, prod: true, ...(d && !d.error ? { daily: d.daily ?? [], lastLogDate } : noData ? { daily: [], lastLogDate: null } : {}) }));
      })
      .catch(() => {
        setAttention(buildAttention({ lastLogDate: null, now: Date.now() }));
        setToday((t) => ({ ...t, prod: true }));
      });
  }, [loadHouses]);

  return (
    <main className="sa-main" style={{ maxWidth: 1160, width: "100%", margin: "0 auto", gap: 12 }}>
      <PushNotifications />
      {/* Status band — health dial · Today (headline, Birds/Climate, problems only) */}
      <section style={{ display: "grid", gridTemplateColumns: isNarrow ? "1fr" : "200px minmax(0, 1fr)", gap: 12, alignItems: "stretch" }}>
        {/* On a phone the Today card comes first: it's what a farmer glances at. */}
        <div style={{ display: "flex", ...(isNarrow ? { maxWidth: 260, width: "100%", margin: "0 auto", order: 2 } : {}) }}>
          {health
            ? <DashStatusBar health={health.health} word={health.word} label={health.label} />
            : <div className="sa-gauge-card" style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: 150, width: "100%", color: "var(--t3)", fontSize: 12 }}>Loading…</div>}
        </div>
        <TodayCard ready={today.prod && today.env} daily={today.daily} lastLogDate={today.lastLogDate} climate={today.climate} extras={attention} narrow={isNarrow} />
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
          Hen-day % and hen-housed % vs typical layer curve (not breed-specific)
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
