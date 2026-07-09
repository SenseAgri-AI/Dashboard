"use client";

import { useCallback, useEffect, useState } from "react";

type Org = { id: string; name: string; slug: string | null; members: number; hasConfig: boolean };

const CONFIG_TEMPLATE = `{
  "farmId": "farm_newclient_001",
  "spreadsheetId": "",
  "sheetRange": "DailyLog!A:R",
  "waterDeviceId": "",
  "feedDeviceId": "",
  "houseHens": { "house1": 0 },
  "priceTiers": [
    { "from": "2025-01-01", "small": 1.0, "medium": 1.3, "large": 1.6, "xl": 1.8, "jumbo": 2.0 }
  ],
  "waterLitresPerPulse": 10,
  "timezoneOffset": 2
}`;

const inputStyle: React.CSSProperties = {
  border: "1px solid rgba(0,0,0,0.14)", background: "#fff", color: "var(--t1)",
  padding: "9px 11px", fontSize: 14, fontFamily: "var(--font-s)", width: "100%", outline: "none",
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--t2)" }}>{label}</span>
      {children}
    </label>
  );
}

export default function AdminClient() {
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [orgName, setOrgName] = useState("");
  const [slug, setSlug] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [configJson, setConfigJson] = useState(CONFIG_TEMPLATE);
  const [status, setStatus] = useState<{ kind: "idle" | "saving" | "ok" | "error"; msg?: string }>({ kind: "idle" });

  const loadOrgs = useCallback(async () => {
    const res = await fetch("/api/admin/orgs");
    if (res.ok) setOrgs((await res.json()).orgs ?? []);
  }, []);
  useEffect(() => { loadOrgs(); }, [loadOrgs]);

  // Auto-suggest a slug from the org name.
  function onNameChange(v: string) {
    setOrgName(v);
    if (!slug || slug === autoSlug(orgName)) setSlug(autoSlug(v));
  }

  async function onboard() {
    setStatus({ kind: "saving" });
    let farmConfig: unknown;
    try {
      farmConfig = JSON.parse(configJson);
    } catch {
      setStatus({ kind: "error", msg: "Farm config is not valid JSON" });
      return;
    }
    const res = await fetch("/api/admin/orgs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orgName, slug, adminEmail, farmConfig }),
    });
    const data = await res.json();
    if (!res.ok) {
      setStatus({ kind: "error", msg: data.error ?? "Failed" });
      return;
    }
    setStatus({ kind: "ok", msg: `Created ${data.org.name}${data.invited ? ` — invited ${adminEmail}` : ""}. Remember to share their sheet with the service account as Editor.` });
    setOrgName(""); setSlug(""); setAdminEmail(""); setConfigJson(CONFIG_TEMPLATE);
    loadOrgs();
  }

  return (
    <main className="sa-main" style={{ maxWidth: 1100, width: "100%", margin: "0 auto", gap: 12 }}>
      <section className="sa-panel" style={{ padding: 0 }}>
        <div className="sa-panel-hd sa-panel-hd--production">Onboard a new farm client</div>
        <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
            <Field label="Organization name"><input value={orgName} onChange={(e) => onNameChange(e.target.value)} style={inputStyle} placeholder="Green Valley Farm" /></Field>
            <Field label="Slug (URL id)"><input value={slug} onChange={(e) => setSlug(e.target.value)} style={inputStyle} placeholder="green-valley" /></Field>
            <Field label="Client admin email"><input type="email" value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} style={inputStyle} placeholder="admin@client.com" /></Field>
          </div>
          <Field label="Farm config (JSON → written to SSM /senseagri/farms/<slug>/config)">
            <textarea value={configJson} onChange={(e) => setConfigJson(e.target.value)} rows={13} spellCheck={false}
              style={{ ...inputStyle, fontFamily: "ui-monospace, monospace", fontSize: 12.5, resize: "vertical" }} />
          </Field>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <button onClick={onboard} disabled={status.kind === "saving"}
              style={{ background: "var(--grad-primary)", color: "#fff", border: "none", boxShadow: "var(--shadow-primary)", padding: "11px 22px", fontSize: 14, fontWeight: 700, cursor: "pointer", opacity: status.kind === "saving" ? 0.6 : 1 }}>
              {status.kind === "saving" ? "Creating…" : "Create organization"}
            </button>
            {status.kind === "ok" && <span style={{ color: "var(--ok)", fontSize: 13, fontWeight: 600 }}>{status.msg}</span>}
            {status.kind === "error" && <span style={{ color: "var(--danger)", fontSize: 13, fontWeight: 600 }}>{status.msg}</span>}
          </div>
        </div>
      </section>

      <section className="sa-panel" style={{ padding: 0 }}>
        <div className="sa-panel-hd sa-panel-hd--welfare">Organizations</div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: "left", color: "var(--t2)" }}>
                {["Name", "Slug", "Members", "Farm config"].map((h) => (
                  <th key={h} style={{ padding: "9px 12px", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em", borderBottom: "1px solid var(--divider)" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {orgs.map((o) => (
                <tr key={o.id} style={{ borderBottom: "1px solid var(--divider)" }}>
                  <td style={{ padding: "9px 12px", fontWeight: 600 }}>{o.name}</td>
                  <td style={{ padding: "9px 12px", fontFamily: "ui-monospace, monospace" }}>{o.slug}</td>
                  <td style={{ padding: "9px 12px" }}>{o.members}</td>
                  <td style={{ padding: "9px 12px", color: o.hasConfig ? "var(--ok)" : "var(--danger)", fontWeight: 700 }}>
                    {o.hasConfig ? "✓ configured" : "✗ missing"}
                  </td>
                </tr>
              ))}
              {orgs.length === 0 && <tr><td colSpan={4} style={{ padding: "20px 12px", color: "var(--t3)", textAlign: "center" }}>No organizations yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

function autoSlug(name: string): string {
  return name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
