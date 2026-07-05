import { SignIn } from "@clerk/nextjs";

export default function SignInPage() {
  return (
    <div className="min-h-screen bg-[#eef2f2] flex items-center justify-center p-6">
      <div className="w-full max-w-3xl flex shadow-2xl overflow-hidden" style={{ minHeight: 560 }}>

        {/* Left brand panel */}
        <div
          className="relative overflow-hidden hidden sm:flex flex-col"
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
                <div className="font-mono uppercase" style={{ color: "#4FB8C5", fontSize: 10, letterSpacing: "0.2em", marginTop: 6 }}>Farm Portal</div>
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

        {/* Right form panel — Clerk-managed auth (email, password, 2FA) */}
        <div className="flex-1 bg-white flex items-center justify-center" style={{ padding: "40px 32px" }}>
          <SignIn
            appearance={{
              variables: {
                colorPrimary: "#2A8E9A",
                borderRadius: "2px",
                fontFamily: "var(--font-body)",
              },
              elements: {
                rootBox: "w-full",
                cardBox: "shadow-none w-full",
                card: "shadow-none p-0",
                headerTitle: "font-display font-bold",
                footer: "hidden",
              },
            }}
          />
        </div>

      </div>
    </div>
  );
}
