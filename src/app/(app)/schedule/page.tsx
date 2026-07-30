"use client";

import { useState } from "react";
import ScheduleTab from "@/components/ScheduleTab";
import EventsTab from "@/components/EventsTab";
import FeedTab from "@/components/FeedTab";

type Tab = "schedule" | "events" | "feed";

export default function SchedulePage() {
  const [tab, setTab] = useState<Tab>("schedule");

  const tabBtn = (key: Tab, label: string) => (
    <button
      onClick={() => setTab(key)}
      style={{
        padding: "9px 18px", fontSize: 13.5, fontWeight: 700, cursor: "pointer", border: "none",
        borderBottom: `2px solid ${tab === key ? "var(--primary)" : "transparent"}`,
        background: "transparent", color: tab === key ? "var(--primary)" : "var(--t3)",
      }}
    >
      {label}
    </button>
  );

  return (
    <main className="sa-main" style={{ maxWidth: 1100, width: "100%", margin: "0 auto", gap: 12 }}>
      <div style={{ display: "flex", gap: 4, borderBottom: "1px solid var(--divider)", overflowX: "auto" }}>
        {tabBtn("schedule", "Schedule")}
        {tabBtn("events", "Events")}
        {tabBtn("feed", "Feed")}
      </div>
      {tab === "schedule" ? <ScheduleTab /> : tab === "events" ? <EventsTab /> : <FeedTab />}
    </main>
  );
}
