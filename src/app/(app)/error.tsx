"use client";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main style={{ padding: 32, fontFamily: "var(--font-s)", maxWidth: 720, margin: "0 auto" }}>
      <h2 style={{ fontFamily: "var(--font-d)", fontSize: 20, fontWeight: 800, color: "var(--danger)", marginBottom: 12 }}>
        Something went wrong rendering this page
      </h2>
      <pre style={{ background: "#fff", border: "1px solid var(--divider)", padding: 16, fontSize: 12, whiteSpace: "pre-wrap", overflowX: "auto", color: "var(--t1)" }}>
        {error?.message || "Unknown error"}
        {error?.digest ? `\n\ndigest: ${error.digest}` : ""}
        {error?.stack ? `\n\n${error.stack}` : ""}
      </pre>
      <button
        onClick={reset}
        style={{ marginTop: 16, background: "var(--teal)", color: "#fff", border: "none", padding: "10px 20px", fontSize: 14, fontWeight: 700, cursor: "pointer" }}
      >
        Try again
      </button>
    </main>
  );
}
