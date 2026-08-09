export function StagingLocationBanner({
  font,
  onAssignLocation,
  body = "Assign a location for receiving and pickup.",
  testIdPrefix,
}: {
  font: string;
  onAssignLocation: () => void;
  body?: string;
  testIdPrefix?: string;
}) {
  const sectionTestId = testIdPrefix
    ? `${testIdPrefix}-needed`
    : "drawer-staging-location-banner";
  const headingTestId = testIdPrefix
    ? `${testIdPrefix}-banner-heading`
    : "drawer-staging-location-banner-heading";
  const bodyTestId = testIdPrefix
    ? `${testIdPrefix}-banner-body`
    : "drawer-staging-location-banner-body";
  const assignTestId = testIdPrefix
    ? `${testIdPrefix}-location-assign`
    : "drawer-staging-location-assign";

  return (
    <section
      data-testid={sectionTestId}
      data-banner-mode="staging_needed"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 10,
        borderRadius: 8,
        border: "2px solid #ea580c",
        backgroundColor: "var(--admin-warning-bg)",
        padding: "14px 16px",
        fontFamily: font,
      }}
    >
      <div>
        <p
          data-testid={headingTestId}
          style={{
            margin: 0,
            fontSize: 13,
            fontWeight: 800,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            color: "var(--admin-warning-text)",
          }}
        >
          STAGING LOCATION NEEDED
        </p>
        <p
          data-testid={bodyTestId}
          style={{
            margin: "6px 0 0",
            fontSize: 14,
            fontWeight: 500,
            color: "var(--admin-warning-text)",
          }}
        >
          {body}
        </p>
      </div>
      <button
        type="button"
        data-testid={assignTestId}
        data-assign-location-cta="true"
        onClick={onAssignLocation}
        style={{
          width: "100%",
          padding: "12px 16px",
          borderRadius: 8,
          border: "2px solid #ca8a04",
          backgroundColor: "#eab308",
          color: "#1c1917",
          fontSize: 15,
          fontWeight: 800,
          letterSpacing: "0.03em",
          cursor: "pointer",
          fontFamily: font,
          boxShadow: "0 2px 8px rgba(234, 179, 8, 0.35)",
        }}
      >
        Assign Location
      </button>
    </section>
  );
}
