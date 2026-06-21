import { useState, useCallback } from "react";
import { Link } from "react-router-dom";
import {
  NAVY,
  BLUE,
  CYAN,
  WHITE,
  STEEL,
  LIGHT_GRAY,
  DEMO_MAILTO,
  FONT,
} from "./theme";
import "./landing.css";

function scrollTo(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
}

const PROBLEMS = [
  {
    title: "Deliveries vanish at the door",
    body: "Drivers drop pallets and leave. Shop staff never get a clean record of what arrived, for which job, or when.",
  },
  {
    title: "Staging becomes a black hole",
    body: "Materials sit on racks with no link to the job. Partial shipments and backorders are invisible until pickup day.",
  },
  {
    title: "Pickup crews guess",
    body: "Field teams show up not knowing what's ready, what's partial, or where it was staged last.",
  },
  {
    title: "No proof when things go missing",
    body: "When an item can't be found, there's no scan trail from vendor drop-off through shop staging to field pickup.",
  },
];

const STEPS = [
  {
    title: "Vendor scans at drop-off",
    body: "Driver or receiver scans a job-linked QR. Delivery is logged with vendor, PO, and timestamp.",
  },
  {
    title: "Shop verifies and stages",
    body: "Staff confirm line items, note partials, and assign a staging location like G2 or S1A.",
  },
  {
    title: "Status stays current",
    body: "Arrived, Partial, Ready for Pickup, and Picked Up update automatically as the job moves.",
  },
  {
    title: "Field sees what's ready",
    body: "Pickup crews check the portal before rolling — no phone tag with the shop.",
  },
  {
    title: "Pickup confirmed",
    body: "Scan at pickup closes the loop. You have a delivery verification and pickup verification record.",
  },
];

const FEATURES = [
  {
    title: "Vendor QR check-in",
    body: "Scan-based vendor delivery tracking for contractors — no clipboards at the loading dock.",
  },
  {
    title: "Shop staging locations",
    body: "Assign rack, aisle, or zone IDs so materials aren't lost in the shop.",
  },
  {
    title: "Partial delivery tracking",
    body: "See what's arrived vs. what's still on order before pickup day surprises you.",
  },
  {
    title: "Pickup portal",
    body: "Field crews verify readiness from phone or tablet before they leave the yard.",
  },
  {
    title: "Job-linked material view",
    body: "Every delivery tied to job number, vendor, and PO — not a generic inventory bucket.",
  },
  {
    title: "Exception alerts",
    body: "Flag shortages, damages, and wrong items at receive so dispatch can act early.",
  },
  {
    title: "Multi-branch ready",
    body: "Start with one shop staging control point and expand to every branch.",
  },
  {
    title: "No full WMS required",
    body: "A material staging system built for trade shops — not warehouse automation.",
  },
];

const INDUSTRIES = [
  "Mechanical",
  "Electrical",
  "Plumbing",
  "HVAC",
  "Fire Protection",
  "Controls",
  "Facility Service",
  "Self-Perform Contractors",
];

const SCALE_STEPS = [
  { label: "One shop", desc: "Pilot a single staging area and one pickup workflow." },
  { label: "Multi-zone", desc: "Add rack IDs, aisles, and exception handling." },
  { label: "Every branch", desc: "Roll out vendor delivery tracking across locations." },
];

interface DeliveryMock {
  job: string;
  vendor: string;
  po: string;
  staging: string;
  status: "Arrived" | "Partial" | "Ready for Pickup" | "Picked Up";
}

const MOCK_DELIVERIES: DeliveryMock[] = [
  { job: "JOB-2847", vendor: "Ferguson", po: "PO-99201", staging: "G2", status: "Ready for Pickup" },
  { job: "JOB-2851", vendor: "Johnstone", po: "PO-99218", staging: "S1A", status: "Partial" },
  { job: "JOB-2839", vendor: "Carrier", po: "PO-99177", staging: "G4", status: "Arrived" },
  { job: "JOB-2822", vendor: "Graybar", po: "PO-99102", staging: "—", status: "Picked Up" },
];

function statusClass(status: DeliveryMock["status"]): string {
  switch (status) {
    case "Arrived":
      return "landing-badge-arrived";
    case "Partial":
      return "landing-badge-partial";
    case "Ready for Pickup":
      return "landing-badge-ready";
    case "Picked Up":
      return "landing-badge-picked";
  }
}

function LandingHeader() {
  const [menuOpen, setMenuOpen] = useState(false);

  const nav = useCallback((id: string) => {
    setMenuOpen(false);
    scrollTo(id);
  }, []);

  return (
    <header className="landing-header">
      <div className="landing-header-inner">
        <a href="#top" onClick={(e) => { e.preventDefault(); scrollTo("top"); }}>
          <img src={`${import.meta.env.BASE_URL}stageverify-logo.png`} alt="StageVerify" className="landing-logo" />
        </a>
        <nav className="landing-nav" aria-label="Main">
          <a href="#problem" onClick={(e) => { e.preventDefault(); nav("problem"); }}>Problem</a>
          <a href="#how-it-works" onClick={(e) => { e.preventDefault(); nav("how-it-works"); }}>How It Works</a>
          <a href="#who-its-for" onClick={(e) => { e.preventDefault(); nav("who-its-for"); }}>Who It&apos;s For</a>
          <a href="#demo" onClick={(e) => { e.preventDefault(); nav("demo"); }}>Demo</a>
        </nav>
        <a href={DEMO_MAILTO} className="landing-btn landing-btn-primary landing-header-cta">
          Request Demo
        </a>
        <button
          type="button"
          className="landing-menu-btn"
          aria-label={menuOpen ? "Close menu" : "Open menu"}
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((o) => !o)}
        >
          <span /><span /><span />
        </button>
      </div>
      {menuOpen && (
        <nav className="landing-mobile-nav" aria-label="Mobile">
          <a href="#problem" onClick={(e) => { e.preventDefault(); nav("problem"); }}>Problem</a>
          <a href="#how-it-works" onClick={(e) => { e.preventDefault(); nav("how-it-works"); }}>How It Works</a>
          <a href="#who-its-for" onClick={(e) => { e.preventDefault(); nav("who-its-for"); }}>Who It&apos;s For</a>
          <a href="#demo" onClick={(e) => { e.preventDefault(); nav("demo"); }}>Demo</a>
          <a href={DEMO_MAILTO} className="landing-btn landing-btn-primary" style={{ textAlign: "center" }}>
            Request Demo
          </a>
        </nav>
      )}
    </header>
  );
}

function HeroMockup() {
  return (
    <div className="landing-mockup">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
        <span style={{ fontWeight: 700, fontSize: "0.875rem", color: NAVY }}>Active Deliveries</span>
        <div className="landing-qr-box" title="Scan QR">QR</div>
      </div>
      {MOCK_DELIVERIES.map((d) => (
        <div key={d.job} className="landing-delivery-row">
          <div style={{ flex: "1 1 140px", minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: "0.875rem" }}>{d.job}</div>
            <div style={{ fontSize: "0.8125rem", color: STEEL }}>{d.vendor} · {d.po}</div>
          </div>
          <div style={{ fontSize: "0.8125rem", color: STEEL }}>
            Staging <strong style={{ color: NAVY }}>{d.staging}</strong>
          </div>
          <span className={`landing-badge ${statusClass(d.status)}`}>{d.status}</span>
        </div>
      ))}
    </div>
  );
}

function LandingFooter() {
  return (
    <footer className="landing-footer">
      <div className="landing-container landing-footer-grid">
        <div>
          <img
            src={`${import.meta.env.BASE_URL}stageverify-logo.png`}
            alt="StageVerify"
            style={{ height: 36, marginBottom: "1rem" }}
          />
          <p style={{ fontSize: "0.9375rem", lineHeight: 1.6, color: "rgba(255,255,255,0.85)", maxWidth: 360 }}>
            StageVerify tracks vendor deliveries from drop-off to shop staging to field pickup,
            so trade contractors know what arrived, where it is, whether it is complete, and when it was picked up.
          </p>
        </div>
        <div>
          <p style={{ fontWeight: 700, marginBottom: "0.75rem" }}>Navigate</p>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            <a href="#problem" onClick={(e) => { e.preventDefault(); scrollTo("problem"); }}>Problem</a>
            <a href="#how-it-works" onClick={(e) => { e.preventDefault(); scrollTo("how-it-works"); }}>How It Works</a>
            <a href="#who-its-for" onClick={(e) => { e.preventDefault(); scrollTo("who-its-for"); }}>Who It&apos;s For</a>
            <a href="#demo" onClick={(e) => { e.preventDefault(); scrollTo("demo"); }}>Demo</a>
          </div>
        </div>
        <div>
          <p style={{ fontWeight: 700, marginBottom: "0.75rem" }}>Product</p>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            <Link to="/receive" style={{ color: "rgba(255,255,255,0.85)" }}>Vendor Receive</Link>
            <Link to="/pickup" style={{ color: "rgba(255,255,255,0.85)" }}>Pickup Portal</Link>
            <Link to="/login" style={{ color: "rgba(255,255,255,0.85)" }}>Sign In</Link>
            <a href={DEMO_MAILTO}>Request Demo</a>
          </div>
        </div>
      </div>
      <p style={{ textAlign: "center", marginTop: "2.5rem", fontSize: "0.8125rem", color: "rgba(255,255,255,0.6)" }}>
        © {new Date().getFullYear()} StageVerify. Material staging and delivery verification for contractors.
      </p>
    </footer>
  );
}

export function LandingPage() {
  return (
    <div className="landing-root" id="top" style={{ fontFamily: FONT }}>
      <LandingHeader />

      {/* Hero */}
      <section className="landing-hero" aria-labelledby="hero-headline">
        <div className="landing-container landing-grid-2">
          <div>
            <h1 id="hero-headline" style={{ fontSize: "clamp(1.75rem, 4vw, 2.75rem)", fontWeight: 800, lineHeight: 1.15, marginBottom: "1.25rem" }}>
              Stop Losing Job Materials Between Delivery and Pickup
            </h1>
            <p style={{ fontSize: "1.0625rem", lineHeight: 1.65, color: "rgba(255,255,255,0.9)", marginBottom: "2rem", maxWidth: 520 }}>
              StageVerify tracks vendor deliveries from drop-off to shop staging to field pickup,
              so trade contractors know what arrived, where it is, whether it is complete, and when it was picked up.
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem" }}>
              <button
                type="button"
                className="landing-btn landing-btn-primary"
                style={{ background: BLUE }}
                onClick={() => scrollTo("how-it-works")}
              >
                See How It Works
              </button>
              <a href={DEMO_MAILTO} className="landing-btn landing-btn-outline-light">
                Request Demo
              </a>
            </div>
          </div>
          <HeroMockup />
        </div>
      </section>

      {/* Problem */}
      <section id="problem" className="landing-section" style={{ background: WHITE }} aria-labelledby="problem-headline">
        <div className="landing-container">
          <h2 id="problem-headline" style={{ fontSize: "clamp(1.5rem, 3vw, 2rem)", fontWeight: 800, color: NAVY, marginBottom: "0.75rem", textAlign: "center" }}>
            The handoff is where job materials disappear.
          </h2>
          <p style={{ textAlign: "center", color: STEEL, maxWidth: 640, margin: "0 auto 2.5rem", lineHeight: 1.6 }}>
            Between vendor drop-off and field pickup, most shops rely on memory, whiteboards, and text threads.
            That gap is where your material staging system breaks down — and where a delivery verification system should start.
          </p>
          <div className="landing-grid-4">
            {PROBLEMS.map((p) => (
              <div key={p.title} className="landing-card">
                <h3 style={{ fontWeight: 700, color: NAVY, marginBottom: "0.5rem", fontSize: "1rem" }}>{p.title}</h3>
                <p style={{ fontSize: "0.9375rem", color: STEEL, lineHeight: 1.55 }}>{p.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Solution */}
      <section id="how-it-works" className="landing-section" style={{ background: LIGHT_GRAY }} aria-labelledby="solution-headline">
        <div className="landing-container">
          <h2 id="solution-headline" style={{ fontSize: "clamp(1.5rem, 3vw, 2rem)", fontWeight: 800, color: NAVY, marginBottom: "0.75rem", textAlign: "center" }}>
            One scan-based trail from vendor drop-off to field pickup.
          </h2>
          <p style={{ textAlign: "center", color: STEEL, maxWidth: 680, margin: "0 auto 2.5rem", lineHeight: 1.6 }}>
            StageVerify is a pickup verification system that connects every handoff with QR scans —
            not a full warehouse platform, just shop staging control that fits how contractors actually work.
          </p>
          <div className="landing-grid-5">
            {STEPS.map((s, i) => (
              <div key={s.title} style={{ textAlign: "center" }}>
                <div className="landing-step-num" style={{ margin: "0 auto 0.75rem" }}>{i + 1}</div>
                <h3 style={{ fontWeight: 700, color: NAVY, marginBottom: "0.5rem", fontSize: "0.9375rem" }}>{s.title}</h3>
                <p style={{ fontSize: "0.8125rem", color: STEEL, lineHeight: 1.5 }}>{s.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="landing-section" style={{ background: NAVY, color: WHITE }} aria-labelledby="features-headline">
        <div className="landing-container">
          <h2 id="features-headline" style={{ fontSize: "clamp(1.5rem, 3vw, 2rem)", fontWeight: 800, marginBottom: "0.75rem", textAlign: "center" }}>
            Shop staging control without a full warehouse system.
          </h2>
          <p style={{ textAlign: "center", color: "rgba(255,255,255,0.8)", maxWidth: 640, margin: "0 auto 2.5rem", lineHeight: 1.6 }}>
            Purpose-built vendor delivery tracking for contractors — scan, stage, verify, pickup.
          </p>
          <div className="landing-grid-8">
            {FEATURES.map((f) => (
              <div key={f.title} className="landing-card-dark">
                <h3 style={{ fontWeight: 700, marginBottom: "0.5rem", fontSize: "0.9375rem", color: CYAN }}>{f.title}</h3>
                <p style={{ fontSize: "0.8125rem", color: "rgba(255,255,255,0.85)", lineHeight: 1.5 }}>{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Who It's For */}
      <section id="who-its-for" className="landing-section" style={{ background: WHITE }} aria-labelledby="industries-headline">
        <div className="landing-container">
          <h2 id="industries-headline" style={{ fontSize: "clamp(1.5rem, 3vw, 2rem)", fontWeight: 800, color: NAVY, marginBottom: "0.75rem", textAlign: "center" }}>
            Who It&apos;s For
          </h2>
          <p style={{ textAlign: "center", color: STEEL, maxWidth: 560, margin: "0 auto 2.5rem", lineHeight: 1.6 }}>
            Any trade contractor moving job materials through a shop before field pickup.
          </p>
          <div className="landing-grid-4">
            {INDUSTRIES.map((ind) => (
              <div key={ind} className="landing-card" style={{ textAlign: "center", padding: "1.25rem" }}>
                <span style={{ fontWeight: 700, color: NAVY, fontSize: "0.9375rem" }}>{ind}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Scale */}
      <section className="landing-section" style={{ background: `linear-gradient(180deg, ${LIGHT_GRAY} 0%, #ffffff 100%)` }} aria-labelledby="scale-headline">
        <div className="landing-container">
          <h2 id="scale-headline" style={{ fontSize: "clamp(1.5rem, 3vw, 2rem)", fontWeight: 800, color: NAVY, marginBottom: "0.75rem", textAlign: "center" }}>
            Start with one shop. Expand to every branch.
          </h2>
          <p style={{ textAlign: "center", color: STEEL, maxWidth: 560, margin: "0 auto 2.5rem", lineHeight: 1.6 }}>
            Roll out at your pace — one staging area first, then zones, then company-wide shop staging control.
          </p>
          <div className="landing-scale-bar">
            {SCALE_STEPS.map((s) => (
              <div key={s.label} className="landing-scale-step">
                <div style={{ fontWeight: 800, color: BLUE, fontSize: "1.0625rem", marginBottom: "0.35rem" }}>{s.label}</div>
                <p style={{ fontSize: "0.8125rem", color: STEEL, lineHeight: 1.5 }}>{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Demo CTA */}
      <section id="demo" className="landing-section" style={{ background: NAVY, color: WHITE, textAlign: "center" }} aria-labelledby="demo-headline">
        <div className="landing-container" style={{ maxWidth: 640 }}>
          <h2 id="demo-headline" style={{ fontSize: "clamp(1.5rem, 3vw, 2.25rem)", fontWeight: 800, marginBottom: "1rem" }}>
            Put your material handoff on a silver platter.
          </h2>
          <p style={{ color: "rgba(255,255,255,0.85)", lineHeight: 1.65, marginBottom: "2rem", fontSize: "1.0625rem" }}>
            See how StageVerify gives your shop a delivery verification system and pickup verification system
            in one scan-based workflow. Request a walkthrough tailored to your operation.
          </p>
          <a href={DEMO_MAILTO} className="landing-btn landing-btn-primary" style={{ background: BLUE, fontSize: "1rem", padding: "0.875rem 2rem" }}>
            Request Demo
          </a>
          <p style={{ marginTop: "1.5rem", fontSize: "0.875rem", color: "rgba(255,255,255,0.65)" }}>
            Or explore the live portals:{" "}
            <Link to="/demo/vendor-scan" style={{ color: CYAN }}>Vendor scan demo</Link>
            {" · "}
            <Link to="/pickup" style={{ color: CYAN }}>Pickup portal</Link>
          </p>
        </div>
      </section>

      <LandingFooter />
    </div>
  );
}
