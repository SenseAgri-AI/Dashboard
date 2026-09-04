import type { AlertItem } from "./DashAlertRow";
import type { EnvData } from "./DashEnvCol";
import { thi, thiZone, type ThiZone } from "@/lib/thi";

const INK = "#002E35";
const TEAL = "#2A8E9A";
const GREEN = "#16A34A";
const AMBER = "#D97706";
const RED = "#DC2626";
const NEUTRAL = "#6B7C80";

type Tone = "good" | "warning" | "danger" | "neutral";
const toneStyle: Record<Tone, { color: string; background: string }> = {
  good: { color: GREEN, background: "#F0FDF4" },
  warning: { color: AMBER, background: "#FFFBEB" },
  danger: { color: RED, background: "#FEF2F2" },
  neutral: { color: NEUTRAL, background: "#F4F7F7" },
};

const zoneTone = (zone: ThiZone | null): Tone => zone === "extreme" || zone === "severe" ? "danger" : zone === "moderate" ? "warning" : zone ? "good" : "neutral";
const zoneLabel = (zone: ThiZone | null) => zone ? zone[0].toUpperCase() + zone.slice(1) : "No data";

function heatSnapshot(env: EnvData | null) {
  const temp = env?.temperature.current;
  const humidity = env?.humidity.current;
  const current = temp != null && humidity != null ? thi(temp, humidity) : null;
  const zone = current == null ? null : thiZone(current);
  const humidityAt = new Map((env?.humidity.sparkline ?? []).map((point) => [point.time, point.value]));
  const values = (env?.temperature.sparkline ?? []).flatMap((point) => {
    const rh = humidityAt.get(point.time);
    return rh == null ? [] : [thi(point.value, rh)];
  });
  let events = 0;
  let stressed = false;
  for (const value of values) {
    const nowStressed = thiZone(value) !== "comfort";
    if (nowStressed && !stressed) events += 1;
    stressed = nowStressed;
  }
  return { current, zone, events, max: values.length ? Math.max(...values) : null };
}

function StatusIcon({ kind }: { kind: "alerts" | "heat" | "air" | "health" }) {
  const props = { width: 22, height: 22, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  if (kind === "alerts") return <svg {...props} aria-hidden><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" /><path d="M10 21h4" /></svg>;
  if (kind === "heat") return <svg {...props} aria-hidden><path d="M14 14.76V5a2 2 0 0 0-4 0v9.76a4 4 0 1 0 4 0Z" /><path d="M12 9v7" /></svg>;
  if (kind === "air") return <svg {...props} aria-hidden><path d="M3 8h11a2 2 0 1 0-2-2" /><path d="M3 12h16a2 2 0 1 1-2 2" /><path d="M3 16h8" /></svg>;
  return <svg {...props} aria-hidden><path d="M12 21s7-3.8 7-10V5l-7-3-7 3v6c0 6.2 7 10 7 10Z" /><path d="M9 12h6M12 9v6" /></svg>;
}

function StatusCard({ kind, label, title, detail, value, tone, badge, onClick }: {
  kind: "alerts" | "heat" | "air" | "health"; label: string; title: string; detail: string; value?: string; tone: Tone; badge?: string; onClick: () => void;
}) {
  const palette = toneStyle[tone];
  return (
    <button type="button" onClick={onClick} style={{ minHeight: 132, background: "#fff", border: "1px solid rgba(0,0,0,0.07)", borderTop: `3px solid ${palette.color}`, boxShadow: "0 1px 2px rgba(0,0,0,0.04), 0 4px 12px rgba(0,0,0,0.04)", padding: "12px 13px", textAlign: "left", cursor: "pointer", display: "flex", flexDirection: "column", fontFamily: "var(--font-s)", minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8, width: "100%" }}>
        <span style={{ width: 38, height: 38, display: "grid", placeItems: "center", color: palette.color, background: palette.background }}><StatusIcon kind={kind} /></span>
        {badge && <span style={{ fontSize: 8, fontWeight: 800, color: AMBER, border: "1px solid #FDE68A", background: "#FFFBEB", padding: "3px 5px" }}>{badge}</span>}
        {value && <strong style={{ fontFamily: "var(--font-d)", fontSize: 19, color: palette.color }}>{value}</strong>}
      </div>
      <span style={{ fontSize: 8.5, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--t3)", marginTop: 10 }}>{label}</span>
      <strong style={{ fontFamily: "var(--font-d)", fontSize: 13.5, lineHeight: 1.25, color: INK, marginTop: 3 }}>{title}</strong>
      <span style={{ fontSize: 9.5, lineHeight: 1.35, color: "var(--t3)", marginTop: 4 }}>{detail}</span>
      <span style={{ fontSize: 9, fontWeight: 800, color: TEAL, marginTop: "auto", paddingTop: 8 }}>VIEW DETAILS →</span>
    </button>
  );
}

const FORECAST = [
  { day: "Today", date: "Fri 4", icon: "🌧️", condition: "Rain", high: 19, low: 11, rain: 79, wind: "20 mph E", risk: "Wet + windy", tone: "warning" as Tone },
  { day: "Sat", date: "Sep 5", icon: "🌦️", condition: "Light rain / showers", high: 20, low: 12, rain: 65, wind: "18 mph NE", risk: "Wet conditions", tone: "warning" as Tone },
  { day: "Sun", date: "Sep 6", icon: "🌧️", condition: "Light rain", high: 17, low: 12, rain: 55, wind: "13 mph NE", risk: "Wet conditions", tone: "warning" as Tone },
  { day: "Mon", date: "Sep 7", icon: "🌦️", condition: "Rain / partly cloudy", high: 18, low: 12, rain: 35, wind: "12 mph NE", risk: "Watch litter", tone: "warning" as Tone },
  { day: "Tue", date: "Sep 8", icon: "☁️", condition: "Mostly cloudy", high: 19, low: 11, rain: 15, wind: "7 mph N", risk: "Low", tone: "good" as Tone },
  { day: "Wed", date: "Sep 9", icon: "🌤️", condition: "Partly sunny", high: 22, low: 10, rain: 10, wind: "5 mph NW", risk: "Low", tone: "good" as Tone },
  { day: "Thu", date: "Sep 10", icon: "☀️", condition: "Mostly sunny", high: 24, low: 10, rain: 0, wind: "4 mph W", risk: "Low", tone: "good" as Tone },
  { day: "Fri", date: "Sep 11", icon: "☀️", condition: "Sunny", high: 26, low: 11, rain: 0, wind: "3 mph SW", risk: "Low", tone: "good" as Tone },
];

function WeatherPlanner({ narrow }: { narrow: boolean }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: narrow ? "1fr" : "minmax(0, 1.35fr) minmax(260px, 0.65fr)", gap: 10, marginTop: 10 }}>
      <div style={{ background: "#fff", border: "1px solid rgba(0,0,0,0.07)", boxShadow: "0 1px 2px rgba(0,0,0,0.04)", padding: "12px 14px" }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
          <div>
            <span style={{ fontFamily: "var(--font-d)", fontWeight: 800, fontSize: 13.5, color: INK }}>Weather-aware farm outlook</span>
            <span style={{ fontSize: 9.5, color: "var(--t3)", marginLeft: 7 }}>forecast conditions → predicted house risk</span>
          </div>
          <span style={{ fontSize: 8, fontWeight: 800, color: TEAL, background: "#EFF8F8", border: "1px solid #B8DCDD", padding: "3px 6px" }}>AREA FORECAST · 4–11 SEP</span>
        </div>
        <div style={{ background: "#F0FDF4", borderLeft: `3px solid ${GREEN}`, padding: "7px 9px", fontSize: 9.5, color: "var(--t2)", marginTop: 10 }}>
          <strong style={{ color: GREEN }}>No forecast heat-stress weather.</strong> Main risk is rain, strong easterly wind and rising house moisture through Monday.
        </div>
        {!narrow && (
          <div style={{ display: "grid", gridTemplateColumns: "68px minmax(135px, 1fr) 76px 54px 76px", gap: 7, padding: "8px 9px 5px", fontSize: 7.5, fontWeight: 800, letterSpacing: "0.07em", color: "var(--t4)", textTransform: "uppercase" }}>
            <span>Day</span><span>Condition</span><span>High / low</span><span>Rain</span><span>Wind</span>
          </div>
        )}
        <div style={{ display: "flex", flexDirection: "column", marginTop: narrow ? 8 : 0, border: "1px solid var(--divider)" }}>
          {FORECAST.map((day) => {
            const palette = toneStyle[day.tone];
            return (
              <div key={`${day.day}-${day.date}`} style={{ display: "grid", gridTemplateColumns: narrow ? "48px minmax(0, 1fr) auto" : "68px minmax(135px, 1fr) 76px 54px 76px", gap: 7, alignItems: "center", padding: narrow ? "7px 8px" : "6px 9px", minWidth: 0, background: palette.background, borderTop: "1px solid var(--divider)" }}>
                <div>
                  <strong style={{ display: "block", fontSize: 9.5, color: INK }}>{day.day}</strong>
                  <span style={{ display: "block", fontSize: 7.5, color: "var(--t3)", marginTop: 1 }}>{day.date}</span>
                </div>
                <div style={{ minWidth: 0 }}>
                  <span style={{ fontSize: 13, marginRight: 5 }} aria-hidden>{day.icon}</span>
                  <span style={{ fontSize: 9, color: "var(--t2)" }}>{day.condition}</span>
                  <span style={{ display: "block", fontSize: 7.5, color: palette.color, fontWeight: 800, marginTop: 2 }}>{day.risk.toUpperCase()}</span>
                </div>
                <strong style={{ fontFamily: "var(--font-d)", fontSize: 11, color: INK }}>{day.high}° / {day.low}°</strong>
                <span style={{ fontSize: 8.5, color: "var(--t3)", gridColumn: narrow ? "2" : undefined }}>Rain <strong style={{ color: day.rain >= 35 ? AMBER : "var(--t2)" }}>{day.rain}%</strong></span>
                <span style={{ fontSize: 8.5, color: "var(--t3)", gridColumn: narrow ? "3" : undefined }}>{day.wind}</span>
              </div>
            );
          })}
        </div>
      </div>

      <div style={{ background: "#fff", border: "1px solid rgba(0,0,0,0.07)", borderLeft: `3px solid ${AMBER}`, boxShadow: "0 1px 2px rgba(0,0,0,0.04)", padding: "12px 14px" }}>
        <div style={{ fontSize: 8.5, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: AMBER }}>Preventive plan · wet weekend</div>
        <div style={{ fontFamily: "var(--font-d)", fontSize: 14, fontWeight: 800, color: INK, marginTop: 5 }}>Keep the house dry without creating draughts</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 10 }}>
          <span style={{ padding: "6px 8px", background: "#F0FDF4", color: GREEN, fontSize: 9, fontWeight: 800 }}>✓ HEAT-STRESS RISK LOW THROUGH 11 SEP</span>
          <span style={{ padding: "6px 8px", background: "#FFFBEB", color: AMBER, fontSize: 9, fontWeight: 800 }}>! WET-LITTER & HUMIDITY RISK ELEVATED</span>
        </div>
        <ol style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: 8, marginTop: 10 }}>
          {["Before rain · Check roof edges, drains and water ingress points.", "During rain · Maintain minimum ventilation while avoiding direct bird-level draughts.", "Twice daily · Inspect litter beneath drinkers and review humidity, CO₂ and air quality.", "After Monday · Dry any wet patches before ammonia risk builds."].map((step, index) => (
            <li key={step} style={{ display: "grid", gridTemplateColumns: "18px minmax(0, 1fr)", gap: 7, fontSize: 9.5, lineHeight: 1.35, color: "var(--t2)" }}>
              <span style={{ width: 17, height: 17, display: "grid", placeItems: "center", background: INK, color: "#fff", fontSize: 8, fontWeight: 800 }}>{index + 1}</span><span>{step}</span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

function formatTime(iso?: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("en-ZA", { timeZone: "Africa/Johannesburg", hour: "2-digit", minute: "2-digit", hour12: false });
}

export default function DashFarmStatus({ alerts, alertsAt, env, narrow = false, onOpenLive, onOpenHealth }: {
  alerts: AlertItem[]; alertsAt?: string | null; env: EnvData | null; narrow?: boolean; onOpenLive: () => void; onOpenHealth: () => void;
}) {
  const heat = heatSnapshot(env);
  const alertTone: Tone = alerts.some((a) => a.status === "danger") ? "danger" : alerts.length ? "warning" : "good";
  const heatTone = zoneTone(heat.zone);
  const co2 = env?.co2.current ?? null;
  const airTone: Tone = env?.co2.status === "danger" ? "danger" : env?.co2.status === "warning" ? "warning" : co2 == null ? "neutral" : "good";
  const heatTitle = heat.zone && heat.zone !== "comfort" ? `${zoneLabel(heat.zone)} heat stress detected` : "No heat stress detected";

  return (
    <section aria-label="Farm status and forecast">
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
        <div>
          <span style={{ fontFamily: "var(--font-d)", fontWeight: 800, fontSize: 15, color: "var(--primary)" }}>Anything needs attention?</span>
          <span style={{ fontSize: 10, color: "var(--t3)", marginLeft: 8 }}>Current farm status at a glance</span>
        </div>
        {alertsAt && <span style={{ fontSize: 9.5, color: "var(--t3)" }}>updated {formatTime(alertsAt)} SAST</span>}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: narrow ? "repeat(2, minmax(0, 1fr))" : "repeat(4, minmax(0, 1fr))", gap: 10 }}>
        <StatusCard kind="alerts" label="Farm alerts" title={alerts.length ? `${alerts.length} active alert${alerts.length === 1 ? "" : "s"}` : "No active alerts"} detail={alerts[0]?.metric ?? "Power, sensors and daily logs look normal."} tone={alertTone} onClick={onOpenLive} />
        <StatusCard kind="heat" label="Heat stress · 24h" title={heatTitle} detail={heat.events ? `${heat.events} event${heat.events === 1 ? "" : "s"} detected · peak ${heat.max?.toFixed(1)}°C effective` : "No threshold crossings in the last 24 hours."} value={heat.current == null ? "—" : `${heat.current.toFixed(1)}°`} tone={heatTone} onClick={onOpenLive} />
        <StatusCard kind="air" label="Ventilation" title={airTone === "good" ? "Air exchange in range" : airTone === "neutral" ? "Waiting for sensor" : "Ventilation needs attention"} detail={co2 == null ? "No current CO₂ reading." : `CO₂ ${Math.round(co2).toLocaleString("en-ZA")} ppm · open live trend`} tone={airTone} onClick={onOpenLive} />
        <StatusCard kind="health" label="Disease screening" title="3 patterns to review" detail="See the acoustic evidence, log-note matches and inspection guidance." tone="warning" badge="DEMO" onClick={onOpenHealth} />
      </div>
      <WeatherPlanner narrow={narrow} />
    </section>
  );
}
