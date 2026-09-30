import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";

interface State {
  error: Error | null;
  info: string;
}

/**
 * Last line of defence: a crash anywhere in the tree is shown on the page with
 * its stack instead of leaving a blank window. Reload clears it; "Reset local
 * data" also drops the autosaved building in case that is what broke.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { error: null, info: "" };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Bauwerk crashed", error, info.componentStack);
    this.setState({ info: info.componentStack ?? "" });
  }

  override render() {
    if (!this.state.error) return this.props.children;
    const { error, info } = this.state;
    return (
      <div
        style={{
          padding: 32,
          fontFamily: "system-ui, sans-serif",
          color: "#1b1d20",
          background: "#f6f6f2",
          minHeight: "100%",
        }}
      >
        <h1 style={{ fontSize: 20, margin: 0 }}>Bauwerk stopped with an error</h1>
        <p style={{ color: "#5b6068" }}>Copy the text below and send it along.</p>
        <pre
          style={{
            whiteSpace: "pre-wrap",
            background: "#fff",
            border: "1px solid #d9dad2",
            padding: 16,
            borderRadius: 8,
            fontSize: 13,
          }}
        >
          {error.name}: {error.message}
          {"\n\n"}
          {error.stack}
          {"\n\nComponent stack:"}
          {info}
        </pre>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            type="button"
            onClick={() => {
              window.location.reload();
            }}
            style={{
              padding: "8px 14px",
              borderRadius: 999,
              border: "1px solid #1b1d20",
              background: "#1b1d20",
              color: "#fff",
            }}
          >
            Reload
          </button>
          <button
            type="button"
            onClick={() => {
              try {
                localStorage.removeItem("bauwerk.building");
              } catch {
                /* ignore */
              }
              window.location.reload();
            }}
            style={{
              padding: "8px 14px",
              borderRadius: 999,
              border: "1px solid #c2431f",
              background: "#fff",
              color: "#c2431f",
            }}
          >
            Reset local data and reload
          </button>
        </div>
      </div>
    );
  }
}
