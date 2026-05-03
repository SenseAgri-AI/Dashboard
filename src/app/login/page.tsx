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
    <div className="min-h-screen blueprint-grid flex items-center justify-center">
      <div className="w-full max-w-sm">
        {/* Logo / header */}
        <div className="bg-[#002E35] px-8 py-6">
          <div className="flex items-center gap-3">
            <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
              <rect width="32" height="32" fill="#2A8E9A" />
              <path d="M8 24 L16 8 L24 24" stroke="#F8FAFA" strokeWidth="2" fill="none" />
              <circle cx="16" cy="8" r="2" fill="#D4AF37" />
            </svg>
            <div>
              <div className="text-[#F8FAFA] font-display font-bold text-lg tracking-tight">SenseAgri</div>
              <div className="text-[#2A8E9A] text-xs font-mono tracking-widest uppercase">Telemetry Dashboard</div>
            </div>
          </div>
        </div>

        {/* Form */}
        <div className="bg-white border border-[#d1dada] border-t-0 px-8 py-8">
          <div className="mb-6">
            <div className="text-[#191C1D] font-display font-semibold text-base">Sign in</div>
            <div className="text-[#5a6b6d] text-sm mt-1">farm_anike_001 · operator access</div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-[#5a6b6d] uppercase tracking-wider mb-1">
                Username
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                autoFocus
                className="w-full border border-[#d1dada] px-3 py-2.5 text-sm text-[#191C1D] bg-[#F8FAFA] focus:outline-none focus:border-[#2A8E9A] transition-colors"
                placeholder="username"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#5a6b6d] uppercase tracking-wider mb-1">
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="w-full border border-[#d1dada] px-3 py-2.5 text-sm text-[#191C1D] bg-[#F8FAFA] focus:outline-none focus:border-[#2A8E9A] transition-colors"
                placeholder="••••••••"
              />
            </div>

            {error && (
              <div className="border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-[#002E35] hover:bg-[#001e23] disabled:opacity-50 text-white font-semibold text-sm py-3 px-4 transition-colors cursor-pointer"
            >
              {loading ? "Signing in…" : "Sign in"}
            </button>
          </form>
        </div>

        <div className="mt-3 text-center text-xs text-[#5a6b6d]">
          SenseAgri Services · {new Date().getFullYear()}
        </div>
      </div>
    </div>
  );
}
