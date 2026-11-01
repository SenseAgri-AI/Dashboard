// The empty row of a logged-records table (feed deliveries, events, daily log). Story: when the list
// fails to load, tell me plainly instead of "nothing logged yet", so I don't enter the same record twice.
export type LoadState = "loading" | "ok" | "error";

export default function ListEmptyRow({ state, colSpan, what, empty, onRetry }: {
  state: LoadState; colSpan: number; what: string; empty: string; onRetry: () => void;
}) {
  return (
    <tr><td colSpan={colSpan} style={{ padding: "20px 12px", color: state === "error" ? "var(--warn)" : "var(--t3)", textAlign: "center" }}>
      {state === "loading" ? `Loading ${what}…`
        : state === "error" ? <>Couldn&apos;t load {what}, so don&apos;t re-enter them yet.{" "}
          <button onClick={onRetry} style={{ background: "transparent", border: "none", color: "var(--teal, #2A8E9A)", fontWeight: 700, cursor: "pointer", padding: 0, font: "inherit" }}>Try again</button></>
        : empty}
    </td></tr>
  );
}
