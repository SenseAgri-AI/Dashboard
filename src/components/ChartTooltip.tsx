import type { CSSProperties, ReactNode } from "react";

// Shared look for every chart tooltip: a light silver-teal card with dark brand ink. A series is
// identified by a small coloured line or swatch beside its name, never by coloured text, so every
// series colour (navy, brown, gold, teal) stays readable.

export const TIP_INK = "#0B2C31";       // values and main text (≈13:1 on the card)
export const TIP_MUTED = "#4A666A";     // names and secondary text (≈5.5:1)
export const TIP_ACCENT = "#1F6F78";    // date / heading line (≈5.3:1)
export const TIP_GOOD = "#166534";
export const TIP_WARN = "#9A4A10";

export const TIP_BOX: CSSProperties = {
  background: "#EEF5F5",
  border: "1px solid #C2DADB",
  borderLeft: "3px solid #2A8E9A",
  borderRadius: 8,
  boxShadow: "0 6px 18px rgba(0, 46, 53, 0.16)",
  padding: "7px 10px",
  fontSize: 12,
  lineHeight: 1.5,
  color: TIP_INK,
  fontFamily: "var(--font-s, Inter, sans-serif)",
  fontVariantNumeric: "tabular-nums",
};

export const TIP_LABEL: CSSProperties = { color: TIP_ACCENT, fontWeight: 700, marginBottom: 3 };

/** Props for Recharts' built-in tooltip, for charts that don't render their own content. */
export const RECHARTS_TIP = {
  contentStyle: TIP_BOX,
  labelStyle: TIP_LABEL,
  itemStyle: { color: TIP_INK, padding: "1px 0" },
};

export function SeriesMark({ color, dashed = false, square = false }: { color: string; dashed?: boolean; square?: boolean }) {
  if (square) return <span aria-hidden style={{ width: 9, height: 9, borderRadius: 2, background: color, flexShrink: 0, display: "inline-block" }} />;
  return (
    <svg width="14" height="6" aria-hidden style={{ flexShrink: 0 }}>
      <line x1="1" y1="3" x2="13" y2="3" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeDasharray={dashed ? "4 2.5" : undefined} />
    </svg>
  );
}

/** One "mark · name ... value" row. */
export function TipRow({ mark, name, value }: { mark?: ReactNode; name: ReactNode; value: ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
      {mark}
      <span style={{ color: TIP_MUTED }}>{name}</span>
      <strong style={{ marginLeft: "auto", paddingLeft: 12, color: TIP_INK }}>{value}</strong>
    </div>
  );
}
