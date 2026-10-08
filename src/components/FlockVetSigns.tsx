"use client";

import { useMemo, useRef, useState } from "react";
import { ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceArea } from "recharts";
import type { WarningSnapshot, WarningDay, SignStatus, SignGroup, HourDetail } from "@/lib/aiDemo";

// Flock Vet — warning signs card. Research-backed drinking and flock signs from the water
// meters, climate sensors and flock noise, each judged against the flock's own recent normal.
// Every flag can be handed to the Flock Vet copilot to investigate.

const PRIMARY = "#002E35";
const TEAL = "#2A8E9A";
const A1 = "#2a78d6"; // A-frame 1 (categorical slot 1)
const A2 = "#eb6834"; // A-frame 2 (categorical slot 2)
const AXIS = "#3a4d4f";
const GRID = "rgba(0,0,0,0.06)";
const MARK: Record<SignStatus, string> = { alert: "#d03b3b", watch: "#fab219", normal: "#C5CFD0", unknown: "#E3E8E8" };

export const STATUS_STYLE: Record<SignStatus, { label: string; fg: string; bg: string; border: string }> = {
  alert: { label: "Alert", fg: "var(--danger)", bg: "var(--danger-bg)", border: "#F5B5B5" },
  watch: { label: "Watch", fg: "var(--warn)", bg: "var(--warn-bg)", border: "#F6D58A" },
  normal: { label: "Normal", fg: "var(--ok)", bg: "var(--ok-bg)", border: "#A7DDB6" },
  unknown: { label: "No data", fg: "var(--t3)", bg: "#F2F4F4", border: "#D5DCDD" },
};

const GROUPS: { key: SignGroup; title: string }[] = [
  { key: "flock", title: "Flock behaviour" },
  { key: "supply", title: "Water supply & meters" },
  { key: "environment", title: "Environment" },
];

const utc = (d: string) => new Date(`${d}T00:00:00Z`);
export const fmtDay = (d: string) =>
  utc(d).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
export const fmtLong = (d: string) =>
  utc(d).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const fmtShort = (d: string) => utc(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const fmtInt = (n: number) => Math.round(n).toLocaleString("en-GB");

export function StatusIcon({ status, size = 12 }: { status: SignStatus; size?: number }) {
  const common = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2.6, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  if (status === "alert") return <svg {...common}><path d="M12 3 2 21h20L12 3Z" /><path d="M12 10v4" /><path d="M12 17.5v.01" /></svg>;
  if (status === "watch") return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>;
  if (status === "normal") return <svg {...common}><path d="M5 12.5 10 17 19 7" /></svg>;
  return <svg {...common}><path d="M6 12h12" /></svg>;
}

export function StatusChip({ status, text }: { status: SignStatus; text?: string }) {
  const s = STATUS_STYLE[status];
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 7px 2px 6px", borderRadius: 999, border: `1px solid ${s.border}`, background: s.bg, color: s.fg, fontSize: 11, fontWeight: 700, lineHeight: 1.4, whiteSpace: "nowrap" }}>
      <StatusIcon status={status} size={11} />
      {text ?? s.label}
    </span>
  );
}

const worst = (d: WarningDay): SignStatus => (d.alerts ? "alert" : d.watches ? "watch" : "normal");

function daySummary(d: WarningDay): string {
  const parts = [];
  if (d.alerts) parts.push(`${d.alerts} alert${d.alerts > 1 ? "s" : ""}`);
  if (d.watches) parts.push(`${d.watches} to watch`);
  return parts.length ? parts.join(", ") : "all signs normal";
}

// Hour as a decimal (06:10 → 6.17) for shading the lit part of the day.
const hourOf = (hhmm: string | null) => {
  if (!hhmm) return null;
  const [h, m] = hhmm.split(":").map(Number);
  return h + m / 60;
};

function WaterTip(props: { active?: boolean; payload?: Array<{ payload?: HourDetail }> }) {
  const p = props.payload?.[0]?.payload;
  if (!props.active || !p) return null;
  const hh = String(p.hour).padStart(2, "0");
  return (
    <div style={{ background: PRIMARY, border: `1px solid ${TEAL}`, borderRadius: 6, padding: "6px 10px", fontSize: 12, color: "#fff", lineHeight: 1.5 }}>
      <div style={{ color: "#8fd0d8", fontWeight: 700 }}>{hh}:00–{hh}:59</div>
      <div>A-frame 1: <strong>{p.wm1_l ?? "—"} L</strong></div>
      <div>A-frame 2: <strong>{p.wm2_l ?? "—"} L</strong></div>
      {p.temp_c != null && <div style={{ color: "#cfe3e5" }}>{p.temp_c} °C · THI {p.thi ?? "—"}</div>}
    </div>
  );
}

function HourlyWater({ hours, day }: { hours: HourDetail[]; day: WarningDay }) {
  const on = hourOf(day.lights_on), off = hourOf(day.lights_off);
  const peak = Math.max(10, ...hours.flatMap((h) => [h.wm1_l ?? 0, h.wm2_l ?? 0]));
  const step = peak <= 100 ? 25 : peak <= 200 ? 50 : 100;
  const top = Math.ceil(peak / step) * step;
  const yTicks = Array.from({ length: top / step + 1 }, (_, i) => i * step);
  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 14px", fontSize: 11.5, color: "var(--t2)", margin: "10px 0 4px" }}>
        <LegendLine color={A1} label="A-frame 1 (WM1)" />
        <LegendLine color={A2} label="A-frame 2 (WM2)" />
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 14, height: 10, background: "#F4EFD9", border: "1px solid #E5DDB8", borderRadius: 2 }} />Lights on (measured)
        </span>
      </div>
      <div style={{ width: "100%", height: 132 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={hours} margin={{ top: 6, right: 8, bottom: 0, left: -6 }}>
            {on != null && off != null && <ReferenceArea x1={on} x2={off} fill="#F4EFD9" fillOpacity={0.9} stroke="none" ifOverflow="hidden" />}
            <CartesianGrid strokeDasharray="2 4" stroke={GRID} vertical={false} />
            <XAxis dataKey="hour" type="number" domain={[0, 23]} ticks={[0, 6, 12, 18, 23]} tickFormatter={(h: number) => `${String(h).padStart(2, "0")}:00`}
              tick={{ fontSize: 10, fill: AXIS }} axisLine={{ stroke: "#d1dada" }} tickLine={false} />
            <YAxis domain={[0, top]} ticks={yTicks} tick={{ fontSize: 10, fill: AXIS }} axisLine={false} tickLine={false} width={36} allowDecimals={false} />
            <Tooltip content={<WaterTip />} cursor={{ stroke: TEAL, strokeOpacity: 0.4 }} />
            <Line dataKey="wm1_l" name="A-frame 1" stroke={A1} strokeWidth={2} dot={false} isAnimationActive={false} connectNulls={false} />
            <Line dataKey="wm2_l" name="A-frame 2" stroke={A2} strokeWidth={2} dot={false} isAnimationActive={false} connectNulls={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div style={{ fontSize: 10.5, color: "var(--t3)", textAlign: "right" }}>Litres per hour</div>
    </div>
  );
}

export function LegendLine({ color, label, dashed }: { color: string; label: string; dashed?: boolean }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <svg width="18" height="6" aria-hidden><line x1="0" y1="3" x2="18" y2="3" stroke={color} strokeWidth="2.5" strokeDasharray={dashed ? "4 3" : undefined} /></svg>
      {label}
    </span>
  );
}

export const smallBtn = (primary: boolean, disabled: boolean): React.CSSProperties => ({
  display: "inline-flex", alignItems: "center", gap: 6, minHeight: 36, padding: "7px 12px", borderRadius: 8,
  border: primary ? "none" : `1px solid ${TEAL}`, background: primary ? (disabled ? "#B9C4C5" : PRIMARY) : "#fff",
  color: primary ? "#fff" : PRIMARY, fontSize: 12.5, fontWeight: 700, fontFamily: "var(--font-s)",
  cursor: disabled ? "default" : "pointer", opacity: !primary && disabled ? 0.55 : 1,
});

export function SparkIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" />
    </svg>
  );
}

export const cardStyle: React.CSSProperties = { background: "#fff", border: "1px solid var(--divider)", borderRadius: 10, padding: "14px 16px" };

export default function FlockVetSigns({ data, narrow, busy, onInvestigate }: {
  data: WarningSnapshot; narrow: boolean; busy: boolean; onInvestigate: (prompt: string) => void;
}) {
  const [sel, setSel] = useState(data.as_of);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const strip = useMemo(() => data.history.slice(narrow ? -14 : -28), [data.history, narrow]);
  const day = data.history.find((d) => d.date === sel) ?? data.history[data.history.length - 1];
  const hours = data.hourly_detail[day.date] ?? [];
  const flagged = day.alerts + day.watches > 0;
  const info = data.sign_info;

  const select = (date: string, scroll = false) => {
    setSel(date);
    // Scroll only the insights pane (not the page) so the header and bottom nav stay put.
    const panel = panelRef.current, pane = panel?.closest("aside");
    if (scroll && panel && pane) {
      pane.scrollBy({ top: panel.getBoundingClientRect().top - pane.getBoundingClientRect().top - 8, behavior: "smooth" });
    }
  };

  const investigateDay = () => {
    const list = day.signs.filter((s) => s.status === "alert" || s.status === "watch")
      .map((s) => `${info[s.key]?.label ?? s.key} (${s.status})`).join("; ");
    onInvestigate(`Investigate ${fmtLong(day.date)}. The warning signs flagged were: ${list}. Work out what happened hour by hour, whether it points to the water supply or meters or to the birds, and what I should check on the farm.`);
  };
  const investigateSign = (key: string, message: string) => {
    onInvestigate(`Investigate the warning sign "${info[key]?.label ?? key}" on ${fmtLong(day.date)}. The panel says: ${message} Is this the water supply or meters, or the birds? What should I check on the farm?`);
  };

  return (
    <section style={cardStyle} aria-labelledby="fv-signs-title">
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
        <div style={{ minWidth: 0 }}>
          <h2 id="fv-signs-title" style={{ margin: 0, fontFamily: "var(--font-d)", fontWeight: 800, fontSize: 16, color: PRIMARY }}>Warning signs</h2>
          <div style={{ fontSize: 12, color: "var(--t3)", marginTop: 2, lineHeight: 1.45 }}>
            {`House 1 · up to ${fmtDay(data.as_of)} · compared with your flock's last 7 normal days`}
          </div>
        </div>
        <span style={{ flexShrink: 0, fontSize: 10, fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase", color: TEAL, border: `1px solid ${TEAL}`, borderRadius: 3, padding: "1px 6px" }}>AI</span>
      </div>

      {/* Flags per day */}
      <div style={{ marginTop: 14 }}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "4px 10px", fontSize: 11.5, color: "var(--t2)", marginBottom: 6 }}>
          <span style={{ fontWeight: 700, color: "var(--t1)" }}>{narrow ? "Last 2 weeks" : "Last 4 weeks"}</span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><span style={{ width: 9, height: 9, background: MARK.alert, borderRadius: 2 }} />Alert</span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><span style={{ width: 9, height: 9, background: MARK.watch, borderRadius: 2 }} />Watch</span>
          <span style={{ color: "var(--t3)" }}>tap a day</span>
        </div>
        <div role="group" aria-label="Signs flagged per day" style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 62 }}>
          {strip.map((d) => {
            const n = d.alerts + d.watches;
            const st = worst(d);
            const selected = d.date === day.date;
            return (
              <button key={d.date} type="button" onClick={() => select(d.date)} aria-pressed={selected}
                aria-label={`${fmtDay(d.date)}: ${daySummary(d)}`} title={`${fmtDay(d.date)}: ${daySummary(d)}`}
                style={{ flex: 1, minWidth: 0, height: "100%", display: "flex", flexDirection: "column", justifyContent: "flex-end", alignItems: "center", gap: 2, padding: "0 0 2px", border: "none", borderRadius: 4, cursor: "pointer", background: selected ? "rgba(0,46,53,0.08)" : "transparent", boxShadow: selected ? `inset 0 0 0 2px ${PRIMARY}` : "none" }}>
                {st === "alert" && <span style={{ color: MARK.alert, display: "flex" }}><StatusIcon status="alert" size={10} /></span>}
                <span style={{ width: "64%", maxWidth: 16, height: n ? 12 + Math.min(n, 6) * 6 : 4, background: MARK[st], borderRadius: "3px 3px 1px 1px" }} />
              </button>
            );
          })}
        </div>
        <div style={{ display: "flex", gap: 2, marginTop: 3 }}>
          {strip.map((d, i) => (
            <span key={d.date} style={{ flex: 1, minWidth: 0, fontSize: 10, color: "var(--t3)", textAlign: i === strip.length - 1 ? "right" : "center", whiteSpace: "nowrap", overflow: "visible", direction: i === strip.length - 1 ? "rtl" : undefined }}>
              {(strip.length - 1 - i) % 7 === 0 ? fmtShort(d.date) : ""}
            </span>
          ))}
        </div>
      </div>

      {/* Selected day */}
      <div ref={panelRef} style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--divider)", scrollMarginTop: 12 }}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
          <span style={{ fontFamily: "var(--font-d)", fontWeight: 800, fontSize: 15, color: "var(--t1)" }}>{fmtDay(day.date)}</span>
          <StatusChip status={worst(day)} text={daySummary(day).replace(/^./, (c) => c.toUpperCase())} />
        </div>
        <div style={{ fontSize: 12, color: "var(--t2)", marginTop: 5, lineHeight: 1.5 }}>
          House water {fmtInt(day.house_litres)} L (A-frame 1 {fmtInt(day.wm1_litres)} L · A-frame 2 {fmtInt(day.wm2_litres)} L)
          {day.lights_on && day.lights_off ? ` · lit ${day.lights_on}–${day.lights_off}` : ""}
        </div>
        {hours.length > 0 && <HourlyWater hours={hours} day={day} />}
        {flagged && (
          <button type="button" onClick={investigateDay} disabled={busy} style={{ ...smallBtn(true, busy), marginTop: 10, minHeight: 40 }}>
            <SparkIcon /> Investigate this day with Flock Vet
          </button>
        )}

        {GROUPS.map((g) => {
          const signs = day.signs.filter((s) => (info[s.key]?.group ?? "flock") === g.key);
          if (!signs.length) return null;
          return (
            <div key={g.key} style={{ marginTop: 12 }}>
              <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: "0.07em", textTransform: "uppercase", color: "var(--t3)", marginBottom: 2 }}>{g.title}</div>
              {signs.map((s) => {
                const hot = s.status === "alert" || s.status === "watch";
                return (
                  <div key={s.key} style={{ display: "grid", gridTemplateColumns: narrow ? "1fr" : "88px 1fr", gap: narrow ? 4 : 10, padding: "8px 0", borderTop: "1px solid var(--divider)", alignItems: "start" }}>
                    <div><StatusChip status={s.status} /></div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 13.5, color: "var(--t1)" }}>{info[s.key]?.label ?? s.key}</div>
                      <div style={{ fontSize: 12.5, color: "var(--t2)", lineHeight: 1.45, marginTop: 1 }}>{s.message}</div>
                      {hot && (
                        <button type="button" onClick={() => investigateSign(s.key, s.message)} disabled={busy} style={{ ...smallBtn(false, busy), marginTop: 6 }}>
                          <SparkIcon /> Investigate
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      {/* Recent flagged days */}
      <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--divider)" }}>
        <div style={{ fontFamily: "var(--font-d)", fontWeight: 800, fontSize: 14, color: "var(--t1)", marginBottom: 4 }}>Recent flagged days</div>
        {data.flagged_days.length === 0 && <div style={{ fontSize: 12.5, color: "var(--t3)" }}>No flags in the last 28 days.</div>}
        {data.flagged_days.map((f) => (
          <button key={f.date} type="button" onClick={() => select(f.date, true)} aria-label={`Show ${fmtDay(f.date)}`}
            style={{ width: "100%", textAlign: "left", display: "grid", gridTemplateColumns: narrow ? "auto 1fr" : "92px 78px 1fr", gap: narrow ? "2px 8px" : 8, alignItems: "start", padding: "8px 6px", minHeight: 44, border: "none", borderTop: "1px solid var(--divider)", background: f.date === day.date ? "rgba(42,142,154,0.08)" : "transparent", cursor: "pointer", fontFamily: "var(--font-s)" }}>
            <span style={{ fontWeight: 700, fontSize: 12.5, color: "var(--t1)", whiteSpace: "nowrap" }}>{fmtDay(f.date)}</span>
            <span><StatusChip status={f.status} /></span>
            <span style={{ gridColumn: narrow ? "1 / -1" : undefined, fontSize: 12, color: "var(--t2)", lineHeight: 1.4, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
              {f.headline}{f.reasons.length > 1 ? ` (+${f.reasons.length - 1} more)` : ""}
            </span>
          </button>
        ))}
      </div>

      <details style={{ marginTop: 12, fontSize: 12, color: "var(--t2)" }}>
        <summary style={{ cursor: "pointer", fontWeight: 700, color: PRIMARY, minHeight: 32, display: "flex", alignItems: "center" }}>How the warning signs work</summary>
        <ul style={{ margin: "6px 0 0", paddingLeft: 18, lineHeight: 1.5 }}>
          <li>{data.baseline}</li>
          {Object.entries(info).map(([k, v]) => <li key={k}><strong>{v.label}:</strong> {v.research}</li>)}
        </ul>
      </details>
    </section>
  );
}
