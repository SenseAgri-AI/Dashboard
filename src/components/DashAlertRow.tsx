export interface AlertItem {
  metric: string;
  status: "normal" | "warning" | "danger" | "neutral";
  message: string;
}

export default function DashAlertRow({ alerts }: { alerts: AlertItem[] }) {
  return (
    <div className="sa-alert-row">
      {alerts.map((a) => (
        <div key={a.metric} className={`sa-alert-card ${a.status}`}>
          <div className="sa-alert-metric">{a.metric}</div>
          <div className="sa-alert-conclusion">{a.message}</div>
        </div>
      ))}
    </div>
  );
}
