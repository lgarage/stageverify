import { signOut } from "firebase/auth";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "./AuthContext";
import { auth } from "./firebase";

function abbreviateEmail(email: string): string {
  const at = email.indexOf("@");
  if (at <= 0) return email;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (email.length <= 22) return email;
  const shortLocal = local.length > 8 ? `${local.slice(0, 6)}…` : local;
  const shortDomain =
    domain.length > 12 ? `${domain.slice(0, 10)}…` : domain;
  return `${shortLocal}@${shortDomain}`;
}

interface HubButtonProps {
  href: string;
  icon: string;
  title: string;
  subtitle: string;
  colorClass: string;
}

function HubButton({ href, icon, title, subtitle, colorClass }: HubButtonProps) {
  return (
    <a
      href={href}
      className={`flex w-full min-h-[80px] items-center gap-4 rounded-2xl px-5 py-4 ${colorClass}`}
    >
      <span className="text-3xl" aria-hidden="true">
        {icon}
      </span>
      <span className="flex flex-col text-left">
        <span className="text-lg font-bold">{title}</span>
        <span className="text-sm opacity-90">{subtitle}</span>
      </span>
    </a>
  );
}

export function MobileHubPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const displayEmail = user?.email ? abbreviateEmail(user.email) : "Staff";

  const handleSignOut = () => {
    void signOut(auth).then(() => {
      navigate("/login", { replace: true });
    });
  };

  return (
    <div
      className="app-container bg-bg-primary text-text-primary"
      style={{ height: "100dvh" }}
    >
      <div className="flex h-full flex-col">
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-3">
          <span className="text-lg font-bold tracking-tight">stageverify</span>
          <div className="flex min-w-0 items-center gap-2">
            <span
              className="truncate text-xs text-text-secondary"
              title={user?.email ?? undefined}
            >
              {displayEmail}
            </span>
            <button
              type="button"
              onClick={handleSignOut}
              className="shrink-0 rounded-lg border border-border bg-bg-secondary px-3 py-2 text-xs font-semibold text-text-primary"
            >
              Sign Out
            </button>
          </div>
        </header>

        <main className="flex flex-1 flex-col justify-center gap-5 px-5 py-8">
          <div className="grid grid-cols-2 gap-3">
            <HubButton
              href="/#/pickup"
              icon="🔧"
              title="Pickup Portal"
              subtitle="Technician checkout"
              colorClass="bg-emerald-600 text-white"
            />
            <HubButton
              href="/#/receive"
              icon="📋"
              title="Vendor Portal"
              subtitle="Receive deliveries"
              colorClass="bg-blue-600 text-white"
            />
          </div>
          <HubButton
            href="/#/"
            icon="📦"
            title="Vendor QR Scanner"
            subtitle="Legacy scan check-in"
            colorClass="bg-amber-600 text-white"
          />
        </main>

        <footer className="shrink-0 px-5 pb-6 pt-2 text-center">
          <Link
            to="/dispatcher"
            className="text-sm text-text-secondary underline-offset-2 hover:underline"
          >
            Open Dispatcher Dashboard →
          </Link>
        </footer>
      </div>
    </div>
  );
}
