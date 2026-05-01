interface DashStatusBarProps {
  health: number;
  word: string;
  label: "normal" | "warning" | "danger";
}

export default function DashStatusBar({ health, word, label }: DashStatusBarProps) {
  const pct = Math.max(2, Math.min(98, health));

  return (
    <div className="sa-status-bar">
      <div>
        <div className="sa-status-eyebrow">Farm status</div>
        <div className={`sa-status-word ${label}`}>{word}</div>
      </div>
      <div className="sa-scale-wrap">
        <div className="sa-scale-track">
          <div className="sa-scale-seg" style={{ background: "#FECACA", borderRadius: "2px 0 0 2px" }} />
          <div className="sa-scale-seg" style={{ background: "#FED7AA" }} />
          <div className="sa-scale-seg" style={{ background: "#FDE68A" }} />
          <div className="sa-scale-seg" style={{ background: "#BBF7D0" }} />
          <div className="sa-scale-seg" style={{ background: "#6EE7B7", borderRadius: "0 2px 2px 0" }} />
          <div className="sa-scale-indicator" style={{ left: `${pct}%` }}>
            <div className="sa-scale-pin" />
            <div className="sa-scale-pin-label">{health} / 100</div>
          </div>
        </div>
        <div className="sa-scale-ends">
          <span className="sa-scale-end">Critical</span>
          <span className="sa-scale-end right">Normal</span>
        </div>
      </div>
      <div className="sa-health-group">
        <div className="sa-status-eyebrow" style={{ textAlign: "right" }}>
          Health score
        </div>
        <div className="sa-health-num">
          {health}
          <span className="sa-health-denom">/100</span>
        </div>
      </div>
    </div>
  );
}
