export function StagingLocationBanner({
  font,
  onAssignLocation,
}: {
  font: string;
  onAssignLocation: () => void;
}) {
  return (
    <section
      data-testid="drawer-staging-location-banner"
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
          data-testid="drawer-staging-location-banner-heading"
          style={{
            margin: 0,
            fontSize: 13,
            fontWeight: 800,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            color: "var(--admin-warning-text)",
          }}
        >
          Staging Location Needed
        </p>
        <p
          data-testid="drawer-staging-location-banner-body"
          style={{
            margin: "6px 0 0",
            fontSize: 14,
            fontWeight: 500,
            color: "var(--admin-warning-text)",
          }}
        >
          Assign a location for receiving and pickup.
        </p>
      </div>
      <button
        type="button"
        data-testid="drawer-staging-location-assign"
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
