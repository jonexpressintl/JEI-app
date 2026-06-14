import React from "react";
import ReactDOM from "react-dom/client";
import { AuthProvider, useAuth } from "./lib/auth";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import PasscodeGate from "./pages/PasscodeGate";
import ErrorBoundary from "./components/ErrorBoundary";

function Root() {
  const { session, loading, passcodeCleared } = useAuth();

  if (loading) {
    return (
      <div style={{minHeight:"100vh",display:"grid",placeItems:"center",fontFamily:"'Inter',sans-serif",color:"#4A5C5A",background:"#F2F4F3"}}>
        Loading…
      </div>
    );
  }
  if (!session) return <Login />;
  // Every user clears their personal passcode before reaching the dashboard.
  if (!passcodeCleared) return <PasscodeGate />;
  return <Dashboard />;
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ErrorBoundary>
      <AuthProvider>
        <Root />
      </AuthProvider>
    </ErrorBoundary>
  </React.StrictMode>
);
