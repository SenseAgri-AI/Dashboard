"use client";

import { useState, useEffect } from "react";

export default function DashNav({ loading }: { loading?: boolean }) {
  const [clock, setClock] = useState("");

  useEffect(() => {
    function tick() {
      setClock(
        new Date().toLocaleString("en-ZA", {
          weekday: "short",
          day: "numeric",
          month: "short",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        }).replace(",", "")
      );
    }
    tick();
    const id = setInterval(tick, 30000);
    return () => clearInterval(id);
  }, []);

  return (
    <nav className="sa-nav">
      <div className="sa-nav-logo">
        <svg viewBox="0 0 90 112" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="45" cy="11" r="7" fill="#D4AF37" />
          <rect x="24" y="32" width="42" height="20" rx="10" fill="#4FB8C5" opacity="0.55" />
          <rect x="10" y="60" width="70" height="20" rx="10" fill="#4FB8C5" opacity="0.75" />
          <rect x="0" y="88" width="90" height="20" rx="10" fill="#4FB8C5" />
        </svg>
        <span className="sa-nav-brand">SenseAgri AI</span>
      </div>
      <div className="sa-nav-sep" />
      <span className="sa-nav-context">
        <strong>Farm Anike</strong> · House 1
      </span>
      <div className="sa-nav-sep" />
      <div className="sa-flock-strip">
        <div className="sa-flock-item">
          <span className="sa-flock-val">4,479</span>
          <span className="sa-flock-unit">birds</span>
        </div>
        <div className="sa-flock-sep" />
        <div className="sa-flock-item">
          <span className="sa-flock-val">20 wks</span>
          <span className="sa-flock-unit">flock age</span>
        </div>
        <div className="sa-flock-sep" />
        <div className="sa-flock-item">
          <span className="sa-flock-val">Apr 2025</span>
          <span className="sa-flock-unit">placed</span>
        </div>
      </div>
      <div className="sa-nav-right">
        {!loading && (
          <>
            <div className="sa-nav-live">
              <span className="sa-live-dot" />
              Live
            </div>
            <div className="sa-nav-sep" />
          </>
        )}
        <span className="sa-nav-time">{clock}</span>
      </div>
    </nav>
  );
}
