"use client";

import { Component, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
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

const Brand = () => (
  <svg viewBox="0 0 90 112" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="45" cy="11" r="7" fill="#D4AF37" />
    <rect x="24" y="32" width="42" height="20" rx="10" fill="#4FB8C5" opacity="0.55" />
    <rect x="10" y="60" width="70" height="20" rx="10" fill="#4FB8C5" opacity="0.75" />
    <rect x="0" y="88" width="90" height="20" rx="10" fill="#4FB8C5" />
  </svg>
);

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
          <Brand />
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
            <OrganizationSwitcher
              hidePersonal
              appearance={{ variables: { colorPrimary: "#2A8E9A" } }}
            />
          </SafeBoundary>
          <UserButton showName appearance={{ variables: { colorPrimary: "#2A8E9A" } }} />
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
