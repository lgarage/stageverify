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
        borderRadius: 8,
        border: "2px solid #ea580c",
        backgroundColor: "var(--admin-warning-bg)",
        padding: "14px 16px",
        fontFamily: font,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 12,
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
          onClick={onAssignLocation}
          style={{
            flexShrink: 0,
            padding: "7px 12px",
            borderRadius: 6,
            border: "1.5px solid var(--admin-warning-border)",
            backgroundColor: "var(--admin-surface)",
            color: "var(--admin-warning-text)",
            fontSize: 12,
            fontWeight: 700,
            cursor: "pointer",
            fontFamily: font,
            whiteSpace: "nowrap",
          }}
        >
          Assign Location
        </button>
      </div>
    </section>
  );
}
