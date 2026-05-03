"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      if (!res.ok) {
        setError("Invalid username or password.");
      } else {
        router.push("/dashboard");
      }
    } catch {
      setError("Connection error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#eef2f2] flex items-center justify-center p-6">
      <div className="w-full max-w-3xl flex shadow-2xl overflow-hidden" style={{ minHeight: 560 }}>

        {/* Left brand panel */}
        <div
          className="relative overflow-hidden flex flex-col"
          style={{ width: "42%", backgroundColor: "#002E35", padding: "48px 40px" }}
        >
          {/* Decorative circles */}
          <div className="absolute rounded-full" style={{ width: 280, height: 280, bottom: -80, left: -80, backgroundColor: "#2A8E9A", opacity: 0.12 }} />
          <div className="absolute rounded-full" style={{ width: 160, height: 160, top: -40, right: -40, backgroundColor: "#D4AF37", opacity: 0.07 }} />

          {/* Logo + brand */}
          <div className="relative z-10 flex-1 flex flex-col justify-between">
            <div>
              <svg width="52" height="65" viewBox="0 0 90 112" fill="none" xmlns="http://www.w3.org/2000/svg">
                <circle cx="45" cy="11" r="7" fill="#D4AF37" />
                <rect x="24" y="32" width="42" height="20" rx="10" fill="#4FB8C5" opacity="0.55" />
                <rect x="10" y="60" width="70" height="20" rx="10" fill="#4FB8C5" opacity="0.75" />
                <rect x="0" y="88" width="90" height="20" rx="10" fill="#4FB8C5" />
              </svg>

              <div style={{ marginTop: 24 }}>
                <div className="text-white font-display font-bold tracking-tight" style={{ fontSize: 22 }}>SenseAgri AI</div>
                <div className="font-mono uppercase" style={{ color: "#4FB8C5", fontSize: 10, letterSpacing: "0.2em", marginTop: 6 }}>Telemetry Dashboard</div>
              </div>
            </div>

            {/* Bottom tagline */}
            <div>
              <div style={{ height: 1, backgroundColor: "#2A8E9A", opacity: 0.35, marginBottom: 20 }} />
              <p style={{ color: "#7dbec7", fontSize: 12, lineHeight: 1.7 }}>
                Real-time environmental monitoring and production analytics for modern poultry operations.
              </p>
            </div>
          </div>
        </div>

        {/* Right form panel */}
        <div className="flex-1 bg-white flex items-center" style={{ padding: "48px 52px" }}>
          <div className="w-full">
            <div style={{ marginBottom: 36 }}>
              <h1 className="font-display font-bold" style={{ color: "#191C1D", fontSize: 24, marginBottom: 6 }}>Welcome back</h1>
              <p style={{ color: "#5a6b6d", fontSize: 14 }}>Sign in to your operator account</p>
            </div>

            <form onSubmit={handleSubmit}>
              <div style={{ marginBottom: 20 }}>
                <label className="block font-semibold uppercase" style={{ color: "#3a4d4f", fontSize: 11, letterSpacing: "0.08em", marginBottom: 8 }}>
                  Username
                </label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                  autoFocus
                  className="w-full focus:outline-none transition-colors"
                  style={{ border: "1px solid #d1dada", padding: "12px 16px", fontSize: 14, color: "#191C1D", backgroundColor: "#f8fbfb", borderRadius: 2 }}
                  onFocus={e => { e.target.style.borderColor = "#2A8E9A"; e.target.style.backgroundColor = "#fff"; }}
                  onBlur={e => { e.target.style.borderColor = "#d1dada"; e.target.style.backgroundColor = "#f8fbfb"; }}
                  placeholder="Enter your username"
                />
              </div>

              <div style={{ marginBottom: 28 }}>
                <label className="block font-semibold uppercase" style={{ color: "#3a4d4f", fontSize: 11, letterSpacing: "0.08em", marginBottom: 8 }}>
                  Password
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="w-full focus:outline-none transition-colors"
                  style={{ border: "1px solid #d1dada", padding: "12px 16px", fontSize: 14, color: "#191C1D", backgroundColor: "#f8fbfb", borderRadius: 2 }}
                  onFocus={e => { e.target.style.borderColor = "#2A8E9A"; e.target.style.backgroundColor = "#fff"; }}
                  onBlur={e => { e.target.style.borderColor = "#d1dada"; e.target.style.backgroundColor = "#f8fbfb"; }}
                  placeholder="Enter your password"
                />
              </div>

              {error && (
                <div style={{ borderLeft: "4px solid #f87171", backgroundColor: "#fef2f2", padding: "12px 16px", fontSize: 14, color: "#b91c1c", marginBottom: 20, borderRadius: 2 }}>
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full font-semibold transition-colors cursor-pointer"
                style={{ backgroundColor: "#2A8E9A", color: "#fff", border: "none", padding: "14px 16px", fontSize: 14, borderRadius: 2, opacity: loading ? 0.6 : 1 }}
                onMouseEnter={e => { if (!loading) (e.target as HTMLElement).style.backgroundColor = "#237d88"; }}
                onMouseLeave={e => { (e.target as HTMLElement).style.backgroundColor = "#2A8E9A"; }}
              >
                {loading ? "Signing in…" : "Sign in"}
              </button>
            </form>

            <p className="text-center" style={{ color: "#9aadae", fontSize: 12, marginTop: 32 }}>
              SenseAgri AI · {new Date().getFullYear()}
            </p>
          </div>
        </div>

      </div>
    </div>
  );
}
