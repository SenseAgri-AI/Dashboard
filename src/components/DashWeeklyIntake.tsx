"use client";

import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export type DailyIntakePoint = { date: string; value: number };

const INK = "#002E35";
const TEAL = "#2A8E9A";
const NAVY = "#2B3F66";
const GREEN = "#16A34A";
const AMBER = "#D97706";

function lastSevenDates(): string[] {
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() - (7 - index));
    return date.toISOString().slice(0, 10);
  });
}

const MOCK_FEED_VALUES = [486, 492, 479, 501, 496, 488, 505];

function dayLabel(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-ZA", { weekday: "short" });
}

function WeeklyTip({ active, payload, label, unit }: { active?: boolean; payload?: { value?: number }[]; label?: string; unit: string }) {
  if (!active || !payload?.length || payload[0].value == null) return null;
  return <div style={{ background: INK, color: "#fff", padding: "6px 8px", fontSize: 9.5 }}><div style={{ opacity: 0.58 }}>{label}</div><strong>{Math.round(payload[0].value).toLocaleString("en-ZA")} {unit}</strong></div>;
}

function WeeklyCard({ title, detail, data, color, unit, sample = false, height }: { title: string; detail: string; data: DailyIntakePoint[]; color: string; unit: string; sample?: boolean; height: number }) {
  const chartData = data.map((point) => ({ day: dayLabel(point.date), value: point.value }));
  const average = chartData.length ? chartData.reduce((sum, point) => sum + point.value, 0) / chartData.length : null;
  return (
    <article style={{ background: "#fff", border: "1px solid rgba(0,0,0,0.07)", boxShadow: "0 1px 2px rgba(0,0,0,0.04), 0 4px 12px rgba(0,0,0,0.04)", padding: "12px 14px 9px", minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
        <div><div style={{ fontFamily: "var(--font-d)", fontSize: 14, fontWeight: 800, color: INK }}>{title}</div><div style={{ fontSize: 9.5, color: "var(--t3)", marginTop: 2 }}>{detail}</div></div>
        <span style={{ fontSize: 8, fontWeight: 800, color: sample ? AMBER : GREEN, whiteSpace: "nowrap" }}>{sample ? "SAMPLE DATA" : "LIVE METER"}</span>
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 5, marginTop: 10 }}>
        <strong style={{ fontFamily: "var(--font-d)", fontSize: 25, color: INK }}>{average == null ? "—" : Math.round(average).toLocaleString("en-ZA")}</strong>
        <span style={{ fontSize: 9.5, fontWeight: 700, color: "var(--t3)" }}>{unit} daily average</span>
      </div>
      {chartData.length < 2 ? <div style={{ height, display: "grid", placeItems: "center", fontSize: 11, color: "var(--t3)" }}>Weekly history will appear after two completed days.</div> : (
        <ResponsiveContainer width="100%" height={height}>
          <LineChart data={chartData} margin={{ top: 12, right: 10, bottom: 0, left: -6 }}>
            <CartesianGrid stroke="#E6EBEB" vertical={false} strokeDasharray="3 3" />
            <XAxis dataKey="day" tick={{ fontSize: 9, fill: "#5A6A6C" }} tickLine={false} axisLine={false} />
            <YAxis tick={{ fontSize: 8.5, fill: "#5A6A6C" }} tickLine={false} axisLine={false} width={46} tickFormatter={(value) => value >= 1000 ? `${(value / 1000).toFixed(1)}k` : `${Math.round(value)}`} />
            <Tooltip content={<WeeklyTip unit={unit} />} cursor={{ stroke: color, strokeOpacity: 0.3 }} />
            <Line type="monotone" dataKey="value" stroke={color} strokeWidth={2.2} dot={{ r: 2.5, fill: color, strokeWidth: 0 }} activeDot={{ r: 4 }} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      )}
    </article>
  );
}

export default function DashWeeklyIntake({ water, feed, narrow = false }: { water: DailyIntakePoint[]; feed: DailyIntakePoint[]; narrow?: boolean }) {
  const feedHasData = feed.length >= 2 && feed.some((point) => point.value > 0);
  const feedSeries = feedHasData ? feed : lastSevenDates().map((date, index) => ({ date, value: MOCK_FEED_VALUES[index] }));
  return (
    <section aria-label="Seven-day feed and water trends">
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
        <div><span style={{ fontFamily: "var(--font-d)", fontWeight: 800, fontSize: 15, color: "var(--primary)" }}>Weekly feed & water</span><span style={{ fontSize: 10, color: "var(--t3)", marginLeft: 8 }}>Last seven completed farm days</span></div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: narrow ? "1fr" : "repeat(2, minmax(0, 1fr))", gap: 10 }}>
        <WeeklyCard title="Water consumption" detail="Daily water-meter totals" data={water} color={TEAL} unit="L/day" height={narrow ? 150 : 170} />
        <WeeklyCard title="Feed consumption" detail={feedHasData ? "Daily feed-meter totals" : "Illustrative flock consumption trend"} data={feedSeries} color={NAVY} unit={feedHasData ? "pulses/day" : "kg/day"} sample={!feedHasData} height={narrow ? 150 : 170} />
      </div>
    </section>
  );
}
