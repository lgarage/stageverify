import { signOut } from "firebase/auth";
import { Navigate } from "react-router-dom";
import { useAuth } from "./AuthContext";
import { auth } from "./firebase";

const NAVY = "#0a3161";
const RED = "#bf0a30";
const FONT = '"Helvetica Neue", Helvetica, Arial, sans-serif';

export function NoAccessPage() {
  const { user, loading, roleLoading, hasDispatcherAccess } = useAuth();

  if (loading || roleLoading) {
    return (
      <div
        style={{
          color: "#94a3b8",
          padding: "2rem",
          textAlign: "center",
          fontFamily: FONT,
        }}
      >
        Loading…
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (hasDispatcherAccess) {
    return <Navigate to="/dispatcher" replace />;
  }

  const handleSignOut = async () => {
    await signOut(auth);
  };

  return (
    <div
      data-testid="no-access-page"
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "2rem",
        background: "#f8fafc",
        fontFamily: FONT,
      }}
    >
      <div
        style={{
          maxWidth: 480,
          width: "100%",
          background: "#fff",
          borderRadius: 12,
          border: "1px solid #e2e8f0",
          padding: "2rem",
          boxShadow: "0 4px 24px rgba(10, 49, 97, 0.08)",
        }}
      >
        <h1
          style={{
            margin: "0 0 0.75rem",
            fontSize: "1.5rem",
            fontWeight: 700,
            color: NAVY,
          }}
        >
          No dispatcher access
        </h1>
        <p
          data-testid="no-access-message"
          style={{
            margin: "0 0 1.25rem",
            fontSize: 15,
            lineHeight: 1.5,
            color: "#333",
          }}
        >
          Your account is signed in but does not have dispatcher permissions.
          Contact a manager to request access, or sign out to use a different
          account.
        </p>
        {user.email && (
          <p
            data-testid="no-access-email"
            style={{
              margin: "0 0 1.5rem",
              fontSize: 13,
              color: "#6b7280",
            }}
          >
            Signed in as {user.email}
          </p>
        )}
        <button
          type="button"
          data-testid="no-access-sign-out"
          onClick={() => void handleSignOut()}
          style={{
            padding: "10px 18px",
            borderRadius: 8,
            border: "none",
            background: RED,
            color: "#fff",
            fontSize: 14,
            fontWeight: 600,
            cursor: "pointer",
            fontFamily: FONT,
          }}
        >
          Sign out
        </button>
      </div>
    </div>
  );
}
