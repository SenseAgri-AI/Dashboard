"use client";

import { Component, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { UserButton, OrganizationSwitcher, useUser, useOrganization } from "@clerk/nextjs";

// Prevents a throwing child (e.g. OrganizationSwitcher when the Clerk instance
// has Organizations disabled) from white-screening the whole app shell.
class SafeBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

const NAV = [
  {
    href: "/home",
    label: "Home",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V21h14V9.5" />
      </svg>
    ),
  },
  {
    href: "/dashboard",
    label: "Dashboard",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="7" height="9" /><rect x="14" y="3" width="7" height="5" />
        <rect x="14" y="12" width="7" height="9" /><rect x="3" y="16" width="7" height="5" />
      </svg>
    ),
  },
  {
    href: "/logs",
    label: "Farm Logs",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
      </svg>
    ),
  },
  {
    href: "/schedule",
    label: "Schedule & Events",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="18" rx="1" /><path d="M16 2v4M8 2v4M3 10h18" />
      </svg>
    ),
  },
  {
    href: "/analytics",
    label: "Analytics",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 3v18h18" /><path d="m19 9-5 5-4-4-3 3" />
      </svg>
    ),
  },
  {
    href: "/assistant",
    label: "Flock Vet",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4.5 3v5a4.5 4.5 0 0 0 9 0V3" /><path d="M9 12.5v2a6 6 0 0 0 6 6 5 5 0 0 0 5-5v-2" /><circle cx="20" cy="11.5" r="2" />
      </svg>
    ),
  },
];

const ADMIN_ITEM = {
  href: "/admin",
  label: "Admin",
  icon: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2 4 6v6c0 5 3.4 8.5 8 10 4.6-1.5 8-5 8-10V6l-8-4Z" />
    </svg>
  ),
};

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(href + "/");
}

// Clerk widgets sit on the dark sidebar — force their trigger text/borders light so
// the org switcher and signed-in user are clearly visible (popovers keep Clerk defaults).
const clerkDark = {
  variables: { colorPrimary: "#2A8E9A" },
  elements: {
    rootBox: { width: "100%" },
    organizationSwitcherTrigger: {
      color: "#fff", width: "100%", justifyContent: "flex-start", padding: "8px 10px",
      border: "1px solid rgba(255,255,255,0.16)", borderRadius: 8, background: "rgba(255,255,255,0.06)",
      fontWeight: 600,
    },
    organizationSwitcherTrigger__open: { background: "rgba(255,255,255,0.12)" },
    organizationPreviewMainIdentifier: { color: "#fff", fontWeight: 700 },
    organizationSwitcherTriggerIcon: { color: "rgba(255,255,255,0.7)" },
    userButtonBox: { color: "#fff" },
    userButtonOuterIdentifier: { color: "#fff", fontWeight: 600 },
  },
} as const;

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const { user } = useUser();

  // When the active organization changes, hard-reload so every page + API call
  // re-runs against the new farm (otherwise the previous org's data lingers).
  const { organization, isLoaded } = useOrganization();
  const orgIdRef = useRef<string | null>(null);
  const orgInit = useRef(false);
  useEffect(() => {
    if (!isLoaded) return;
    const id = organization?.id ?? null;
    if (!orgInit.current) { orgInit.current = true; orgIdRef.current = id; return; }
    if (orgIdRef.current !== id) { orgIdRef.current = id; window.location.href = "/home"; }
  }, [isLoaded, organization?.id]);

  useEffect(() => {
    try { if (localStorage.getItem("sa-sidebar-collapsed") === "1") setCollapsed(true); } catch {}
  }, []);
  const setCollapse = (v: boolean) => {
    setCollapsed(v);
    try { localStorage.setItem("sa-sidebar-collapsed", v ? "1" : "0"); } catch {}
  };
  // Top-bar menu button: drawer on mobile, collapse/expand on desktop.
  const toggleNav = () => {
    if (typeof window !== "undefined" && window.matchMedia("(max-width: 900px)").matches) setOpen((v) => !v);
    else setCollapse(!collapsed);
  };
  const isSuper = user?.publicMetadata?.role === "superadmin";
  const navItems = isSuper ? [...NAV, ADMIN_ITEM] : NAV;
  const current = navItems.find((n) => isActive(pathname, n.href));

  return (
    <div className={`sa-shell ${collapsed ? "collapsed" : ""}`}>
      {/* Sidebar (desktop) / drawer (mobile) */}
      <aside className={`sa-sidebar ${open ? "open" : ""}`}>
        <div className="sa-side-brand">
          <Image src="/logo-dark.jpg" alt="SenseAgri" width={36} height={36} priority style={{ borderRadius: 8, flexShrink: 0, display: "block" }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="sa-side-brand-text">SenseAgri AI</div>
            <div className="sa-side-brand-sub">Farm Portal</div>
          </div>
          <button className="sa-collapse-btn" onClick={() => setCollapse(true)} aria-label="Collapse sidebar" title="Collapse sidebar">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m11 17-5-5 5-5" /><path d="m18 17-5-5 5-5" />
            </svg>
          </button>
        </div>

        <nav className="sa-side-nav">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setOpen(false)}
              className={`sa-side-link ${isActive(pathname, item.href) ? "active" : ""}`}
            >
              {item.icon}
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="sa-side-foot">
          <SafeBoundary>
            <OrganizationSwitcher hidePersonal appearance={clerkDark} />
          </SafeBoundary>
          <div className="sa-side-user">
            <UserButton showName appearance={clerkDark} />
          </div>
        </div>
      </aside>

      {/* Mobile backdrop */}
      <div
        className={`sa-drawer-backdrop ${open ? "open" : ""}`}
        onClick={() => setOpen(false)}
        aria-hidden
      />

      {/* Content */}
      <div className="sa-content">
        <header className="sa-topbar">
          <button className="sa-menu-btn" onClick={toggleNav} aria-label="Toggle sidebar" title="Toggle sidebar">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>
          <span className="sa-topbar-title">{current?.label ?? "SenseAgri"}</span>
          <div className="sa-topbar-right">
            <span className="sa-nav-live">
              <span className="sa-live-dot" />
              Live
            </span>
          </div>
        </header>

        {children}
      </div>

      {/* Mobile bottom nav */}
      <nav className="sa-mobile-nav">
        {navItems.map((item) => (
          <Link key={item.href} href={item.href} className={`sa-mobile-link ${isActive(pathname, item.href) ? "active" : ""}`}>
            {item.icon}
            {item.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
