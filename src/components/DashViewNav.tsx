export type DashboardView = "overview" | "live" | "health" | "resources";

const VIEWS: { id: DashboardView; label: string; detail: string }[] = [
  { id: "overview", label: "Overview", detail: "Production & status" },
  { id: "live", label: "Live monitoring", detail: "House conditions" },
  { id: "health", label: "Health intelligence", detail: "Detection & flags" },
  { id: "resources", label: "Feed & water", detail: "Intake & silos" },
];

function ViewIcon({ view }: { view: DashboardView }) {
  const common = { width: 17, height: 17, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  if (view === "overview") return <svg {...common} aria-hidden><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /></svg>;
  if (view === "live") return <svg {...common} aria-hidden><path d="M3 12h4l2-6 4 12 2-6h6" /></svg>;
  if (view === "health") return <svg {...common} aria-hidden><path d="M12 21s7-3.8 7-10V5l-7-3-7 3v6c0 6.2 7 10 7 10Z" /><path d="M9 12h6M12 9v6" /></svg>;
  return <svg {...common} aria-hidden><path d="M6 3v12M18 3v12M4 7h4M16 7h4" /><path d="M6 15c0 4 3 6 6 6s6-2 6-6" /></svg>;
}

export default function DashViewNav({ active, onChange, narrow = false }: { active: DashboardView; onChange: (view: DashboardView) => void; narrow?: boolean }) {
  return (
    <nav aria-label="Dashboard views" style={{ background: "rgba(255,255,255,0.64)", border: "1px solid rgba(0,0,0,0.07)", padding: 4 }}>
      <div style={{ display: "grid", gridTemplateColumns: narrow ? "repeat(2, minmax(0, 1fr))" : "repeat(4, minmax(0, 1fr))", gap: 4 }}>
        {VIEWS.map((view) => {
          const selected = view.id === active;
          return (
            <button key={view.id} type="button" aria-pressed={selected} onClick={() => onChange(view.id)}
              style={{ minHeight: 48, border: selected ? "1px solid #002E35" : "1px solid transparent", background: selected ? "#002E35" : "transparent", color: selected ? "#fff" : "var(--t2)", padding: "7px 10px", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, cursor: "pointer", fontFamily: "var(--font-s)" }}>
              <ViewIcon view={view.id} />
              <span style={{ minWidth: 0, textAlign: "left" }}>
                <strong style={{ display: "block", fontSize: 11.5, lineHeight: 1.2 }}>{view.label}</strong>
                <span style={{ display: "block", fontSize: 8.5, color: selected ? "rgba(255,255,255,0.58)" : "var(--t3)", marginTop: 2 }}>{view.detail}</span>
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
