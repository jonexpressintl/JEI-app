import React from "react";

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    console.error("JEI app crashed:", error, info);
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", fontFamily: "'Inter',sans-serif", background: "#F2F4F3", padding: 20 }}>
          <div style={{ maxWidth: 480, background: "#fff", borderRadius: 14, padding: 24, boxShadow: "0 8px 30px rgba(0,0,0,.08)" }}>
            <h2 style={{ margin: "0 0 8px", color: "#B23B3B" }}>Something went wrong</h2>
            <p style={{ fontSize: 13, color: "#666", lineHeight: 1.6 }}>
              {this.state.error?.message || String(this.state.error)}
            </p>
            <button onClick={() => { this.setState({ error: null }); window.location.reload(); }}
              style={{ marginTop: 12, background: "#1A6B5C", color: "#fff", border: "none", borderRadius: 8, padding: "8px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
              Reload page
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
