import { useState, type FormEvent } from "react";
import {
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
} from "firebase/auth";
import { useNavigate, useSearchParams } from "react-router-dom";
import { auth } from "../firebase";

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
    return "/";
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
      /* anti-enumeration */
    } finally {
      setForgotSubmitting(false);
      setView("forgot-done");
    }
  };

  return (
    <div className="operator-login-page" data-testid="login-page">
      <div className="operator-login-card">
        <h1>StageVerify Operator</h1>
        <p className="operator-login-subtitle">
          {view === "login" ? "Operator sign in" : "Reset password"}
        </p>

        {view === "login" ? (
          <form onSubmit={(e) => void handleSubmit(e)}>
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            {error ? (
              <p className="operator-login-error" role="alert">
                {error}
              </p>
            ) : null}
            <button type="submit" disabled={submitting}>
              {submitting ? "Signing in…" : "Sign In"}
            </button>
            <button type="button" onClick={() => setView("forgot")}>
              Forgot password?
            </button>
          </form>
        ) : null}

        {view === "forgot" ? (
          <form onSubmit={(e) => void handleForgotSubmit(e)}>
            <label htmlFor="forgot-email">Email</label>
            <input
              id="forgot-email"
              type="email"
              required
              value={forgotEmail}
              onChange={(e) => setForgotEmail(e.target.value)}
            />
            <button type="submit" disabled={forgotSubmitting}>
              {forgotSubmitting ? "Sending…" : "Send reset link"}
            </button>
            <button type="button" onClick={() => setView("login")}>
              Back to sign in
            </button>
          </form>
        ) : null}

        {view === "forgot-done" ? (
          <div>
            <p role="status">{FORGOT_SUCCESS_MESSAGE}</p>
            <button type="button" onClick={() => setView("login")}>
              Back to sign in
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
