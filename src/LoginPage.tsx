import { useState, type FormEvent } from "react";
import {
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
} from "firebase/auth";
import { useNavigate, useSearchParams } from "react-router-dom";
import { auth } from "./firebase";
import { StageVerifyBrandMark } from "./StageVerifyBrandMark";

const NAVY = "#0a3161";
const RED = "#bf0a30";

/** Post-reset continue URL — Firebase Auth email link lands here (locked D-60). */
const RESET_CONTINUE_URL = "https://lgarage.github.io/stageverify/#/login";

const FORGOT_SUCCESS_MESSAGE =
  "If that email is registered, a reset link has been sent.";

type View = "login" | "forgot" | "forgot-done";

function authErrorMessage(code: string): string {
  switch (code) {
    case "auth/user-not-found":
    case "auth/wrong-password":
    case "auth/invalid-credential":
      return "Invalid email or password.";
    case "auth/invalid-email":
      return "Please enter a valid email address.";
    case "auth/too-many-requests":
      return "Too many attempts. Please try again later.";
    default:
      return "Sign in failed. Please try again.";
  }
}

function resolvePostLoginPath(next: string | null): string {
  if (!next || !next.startsWith("/") || next.startsWith("//")) {
    return "/dispatcher";
  }
  return next;
}

export function LoginPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [view, setView] = useState<View>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [forgotEmail, setForgotEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [forgotSubmitting, setForgotSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
      navigate(resolvePostLoginPath(searchParams.get("next")), {
        replace: true,
      });
    } catch (err: unknown) {
      const code =
        err instanceof Error && "code" in err
          ? String((err as { code: string }).code)
          : "unknown";
      setError(authErrorMessage(code));
    } finally {
      setSubmitting(false);
    }
  };

  const handleForgotSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setForgotSubmitting(true);

    try {
      await sendPasswordResetEmail(auth, forgotEmail.trim(), {
        url: RESET_CONTINUE_URL,
        handleCodeInApp: false,
      });
    } catch {
      // Anti-enumeration: identical outcome regardless of Firebase response.
    } finally {
      setForgotSubmitting(false);
      setView("forgot-done");
    }
  };

  const openForgot = () => {
    setForgotEmail(email);
    setError(null);
    setView("forgot");
  };

  const backToLogin = () => {
    setView("login");
    setError(null);
  };

  return (
    <div
      className="min-h-screen flex items-center justify-center px-4"
      style={{ backgroundColor: "var(--color-bg-primary)" }}
      data-testid="login-page"
    >
      <div
        className="w-full max-w-sm rounded-lg p-8"
        style={{
          backgroundColor: "var(--color-bg-secondary)",
          border: "1px solid var(--color-border)",
        }}
      >
        <div className="mb-8 text-center">
          <StageVerifyBrandMark
            height={64}
            className="mx-auto mb-4"
            style={{
              marginLeft: "auto",
              marginRight: "auto",
              filter: "drop-shadow(0 5px 14px rgba(0,0,0,0.28))",
            }}
          />
          <h1
            className="text-2xl font-bold tracking-tight"
            style={{ color: "var(--color-text-primary)" }}
          >
            StageVerify
          </h1>
          <p
            className="mt-2 text-sm"
            style={{ color: "var(--color-text-secondary)" }}
          >
            {view === "login" ? "Dispatcher sign in" : "Reset password"}
          </p>
        </div>

        {view === "login" && (
          <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
            <div>
              <label
                htmlFor="email"
                className="block text-sm font-medium mb-1.5"
                style={{ color: "var(--color-text-secondary)" }}
              >
                Email
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded px-3 py-2 text-sm outline-none"
                style={{
                  backgroundColor: "var(--color-bg-surface)",
                  border: "1px solid var(--color-border)",
                  color: "var(--color-text-primary)",
                }}
              />
            </div>

            <div>
              <label
                htmlFor="password"
                className="block text-sm font-medium mb-1.5"
                style={{ color: "var(--color-text-secondary)" }}
              >
                Password
              </label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded px-3 py-2 text-sm outline-none"
                style={{
                  backgroundColor: "var(--color-bg-surface)",
                  border: "1px solid var(--color-border)",
                  color: "var(--color-text-primary)",
                }}
              />
            </div>

            {error && (
              <p
                className="text-sm rounded px-3 py-2"
                style={{
                  backgroundColor: "rgba(239, 68, 68, 0.1)",
                  color: "#fca5a5",
                  border: "1px solid rgba(239, 68, 68, 0.3)",
                }}
                role="alert"
              >
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded py-2.5 text-sm font-bold transition-opacity disabled:opacity-60"
              style={{
                backgroundColor: submitting ? NAVY : RED,
                color: "#fff",
              }}
            >
              {submitting ? "Signing in…" : "Sign In"}
            </button>

            <p className="text-center text-sm">
              <button
                type="button"
                data-testid="forgot-password-link"
                onClick={openForgot}
                className="underline-offset-2 hover:underline"
                style={{ color: "var(--color-text-secondary)" }}
              >
                Forgot password?
              </button>
            </p>
          </form>
        )}

        {view === "forgot" && (
          <form
            onSubmit={(e) => void handleForgotSubmit(e)}
            className="space-y-4"
            data-testid="forgot-password-form"
          >
            <p
              className="text-sm"
              style={{ color: "var(--color-text-secondary)" }}
            >
              Enter your account email and we&apos;ll send a reset link.
            </p>

            <div>
              <label
                htmlFor="forgot-email"
                className="block text-sm font-medium mb-1.5"
                style={{ color: "var(--color-text-secondary)" }}
              >
                Email
              </label>
              <input
                id="forgot-email"
                type="email"
                autoComplete="email"
                required
                value={forgotEmail}
                onChange={(e) => setForgotEmail(e.target.value)}
                className="w-full rounded px-3 py-2 text-sm outline-none"
                style={{
                  backgroundColor: "var(--color-bg-surface)",
                  border: "1px solid var(--color-border)",
                  color: "var(--color-text-primary)",
                }}
              />
            </div>

            <button
              type="submit"
              disabled={forgotSubmitting}
              data-testid="forgot-password-submit"
              className="w-full rounded py-2.5 text-sm font-bold transition-opacity disabled:opacity-60"
              style={{
                backgroundColor: forgotSubmitting ? NAVY : RED,
                color: "#fff",
              }}
            >
              {forgotSubmitting ? "Sending…" : "Send reset link"}
            </button>

            <p
              className="text-center text-xs"
              style={{ color: "var(--color-text-secondary)" }}
            >
              Need your username? Contact your admin.
            </p>

            <p className="text-center text-sm">
              <button
                type="button"
                data-testid="back-to-login"
                onClick={backToLogin}
                className="underline-offset-2 hover:underline"
                style={{ color: "var(--color-text-secondary)" }}
              >
                Back to sign in
              </button>
            </p>
          </form>
        )}

        {view === "forgot-done" && (
          <div className="space-y-4" data-testid="forgot-password-done">
            <p
              className="text-sm rounded px-3 py-2"
              style={{
                backgroundColor: "rgba(34, 197, 94, 0.1)",
                color: "#86efac",
                border: "1px solid rgba(34, 197, 94, 0.3)",
              }}
              role="status"
              data-testid="forgot-password-success"
            >
              {FORGOT_SUCCESS_MESSAGE}
            </p>

            <p className="text-center text-sm">
              <button
                type="button"
                data-testid="back-to-login-done"
                onClick={backToLogin}
                className="underline-offset-2 hover:underline"
                style={{ color: "var(--color-text-secondary)" }}
              >
                Back to sign in
              </button>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
