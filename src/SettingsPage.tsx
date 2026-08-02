import { useState, useEffect, useMemo, type CSSProperties } from "react";
import { Navigate, Link, useLocation } from "react-router-dom";
import {
  LOCATION_STATUSES,
  type LocationStatus,
  type StagingLocation,
  type VendorDeliveryMode,
  type AppSettings,
} from "./dispatcher/models";
import {
  findStagingLocationByCode,
  formatStagingCodeCanonical,
} from "./dispatcher/stagingCode";
import {
  getAppSettings,
  updateAppSettings,
  listAllZones,
  createZone,
  updateZone,
  subscribeAppSettings,
  getEmailProviderConnection,
  initiateGmailOAuth,
  disconnectGmailOAuth,
  configureInvoiceTrainingAdmin,
  getInvoiceTrainingAdminStatus,
} from "./dispatcher/firestoreService";
import {
  stagingListRowsForShopMap,
  isMapSlotPlaceholderStagingLocation,
} from "./dispatcher/stagingMapSync";
import type { ShopMapLayoutExtras } from "./dispatcher/shopMapLayout";
import type { EmailProviderConnection } from "./dispatcher/models";
import { STAGEVERIFY_BOT_INBOX } from "./dispatcher/email/stageverifyBotInbox";
import {
  PORTAL_SHELL_CLASS,
  PORTAL_MAIN_CLASS,
  PORTAL_SCROLL_CLASS,
} from "./dispatcherPortalLayout";
import { portalNavFocus } from "./dispatcherPortalNav";
import { PortalSidebar } from "./PortalSidebar";
import { DispatcherPortalTopBar } from "./DispatcherPortalTopBar";
import { useDispatcherPortal } from "./dispatcher/DispatcherPortalContext";
import { TechnicianSettingsPanel } from "./TechnicianSettingsPanel";
import { OfficeReceiversSettingsPanel } from "./OfficeReceiversSettingsPanel";
import { ManagementSettingsPanel } from "./ManagementSettingsPanel";
import { NAVY, RED } from "./theme/brandColors";

const FONT = '"Helvetica Neue", Helvetica, Arial, sans-serif';

const STAGING_SPOT_TYPES = ["ground", "shelf", "bin", "other"] as const;
type StagingSpotType = (typeof STAGING_SPOT_TYPES)[number];

const STAGING_TYPE_LABELS: Record<StagingSpotType, string> = {
  ground: "Ground",
  shelf: "Shelf",
  bin: "Bin",
  other: "Other",
};

const LOCATION_STATUS_LABEL: Record<LocationStatus, string> = {
  Planned: "Planned (inactive)",
  Installed: "Installed",
  Tagged: "Tagged",
  Active: "Active",
};

type StagingSpotEditForm = {
  code: string;
  label: string;
  type: StagingSpotType;
  status: LocationStatus;
  sortOrder: string;
};

function spotToEditForm(spot: StagingLocation): StagingSpotEditForm {
  return {
    code: spot.code,
    label: spot.label,
    type: spot.type as StagingSpotType,
    status: spot.status,
    sortOrder: spot.sortOrder != null ? String(spot.sortOrder) : "",
  };
}

function findOtherSpotByCode(
  spots: StagingLocation[],
  code: string,
  excludeId: string,
): StagingLocation | undefined {
  const found = findStagingLocationByCode(spots, code);
  if (!found || found.id === excludeId) return undefined;
  return found;
}

export function SettingsPage() {
  const location = useLocation();
  const {
    refreshBusy,
    gmailSyncMessage,
    lastUpdated,
    handleRefreshNow,
  } = useDispatcherPortal();
  const [revertWindowMinutes, setRevertWindowMinutes] = useState(60);
  const [vendorDeliveryMode, setVendorDeliveryMode] =
    useState<VendorDeliveryMode>("full_checkin");
  const [vendorSessionMinutes, setVendorSessionMinutes] = useState(15);
  const [shopLatitude, setShopLatitude] = useState("");
  const [shopLongitude, setShopLongitude] = useState("");
  const [shopGeofenceRadiusMeters, setShopGeofenceRadiusMeters] = useState("");
  const [vendorGeofenceEnforce, setVendorGeofenceEnforce] = useState(false);
  const [monitoringInboxEmail, setMonitoringInboxEmail] = useState("");
  const [emailMonitoringEnabled, setEmailMonitoringEnabled] = useState(false);
  const [invoiceAiShadowEnabled, setInvoiceAiShadowEnabled] = useState(false);
  const [invoiceTrainingAlertEmail, setInvoiceTrainingAlertEmail] = useState("");
  const [invoiceTrainingAdminPassword, setInvoiceTrainingAdminPassword] =
    useState("");
  const [invoiceTrainingPasswordConfigured, setInvoiceTrainingPasswordConfigured] =
    useState(false);
  const [savingTrainingAdmin, setSavingTrainingAdmin] = useState(false);
  const [trainingAdminSaved, setTrainingAdminSaved] = useState(false);
  const [trainingAdminError, setTrainingAdminError] = useState<string | null>(
    null,
  );
  const [savingRevert, setSavingRevert] = useState(false);
  const [revertSaved, setRevertSaved] = useState(false);
  const [savingEmail, setSavingEmail] = useState(false);
  const [emailSaved, setEmailSaved] = useState(false);
  const [gmailConnection, setGmailConnection] = useState<EmailProviderConnection | null>(
    null,
  );
  const [loadingGmailConnection, setLoadingGmailConnection] = useState(true);
  const [connectingGmail, setConnectingGmail] = useState(false);
  const [disconnectingGmail, setDisconnectingGmail] = useState(false);
  const [gmailOAuthMessage, setGmailOAuthMessage] = useState<string | null>(null);

  const [allZones, setAllZones] = useState<StagingLocation[]>([]);
  const [mapLayoutExtras, setMapLayoutExtras] = useState<ShopMapLayoutExtras>(
    {},
  );
  const [loadingSpots, setLoadingSpots] = useState(true);

  const [editingSpotId, setEditingSpotId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<StagingSpotEditForm | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  useEffect(() => {
    setLoadingSpots(true);
    void Promise.all([listAllZones(), getAppSettings()])
      .then(([spots, settings]) => {
        setAllZones(spots);
        setMapLayoutExtras(settings.shopMapLayoutExtras ?? {});
      })
      .finally(() => setLoadingSpots(false));
  }, []);

  useEffect(() => {
    return subscribeAppSettings((settings) => {
      setMapLayoutExtras(settings.shopMapLayoutExtras ?? {});
    });
  }, []);

  const stagingSpotRows = useMemo(
    () => stagingListRowsForShopMap(allZones, mapLayoutExtras),
    [allZones, mapLayoutExtras],
  );

  const stagingSpots = useMemo(
    () => stagingSpotRows.map((row) => row.spot),
    [stagingSpotRows],
  );

  useEffect(() => {
    if (!lastUpdated) return;
    void listAllZones().then(setAllZones);
  }, [lastUpdated]);

  useEffect(() => {
    void getAppSettings().then((settings) => {
      setRevertWindowMinutes(settings.vendorRevertWindowMinutes);
      setVendorDeliveryMode(settings.vendorDeliveryMode ?? "full_checkin");
      setVendorSessionMinutes(settings.vendorSessionMinutes ?? 15);
      setShopLatitude(
        settings.shopLatitude != null ? String(settings.shopLatitude) : "",
      );
      setShopLongitude(
        settings.shopLongitude != null ? String(settings.shopLongitude) : "",
      );
      setShopGeofenceRadiusMeters(
        settings.shopGeofenceRadiusMeters != null
          ? String(settings.shopGeofenceRadiusMeters)
          : "",
      );
      setVendorGeofenceEnforce(settings.vendorGeofenceEnforce === true);
      setMonitoringInboxEmail(settings.monitoringInboxEmail ?? "");
      setEmailMonitoringEnabled(settings.emailMonitoringEnabled === true);
      setInvoiceAiShadowEnabled(settings.invoiceAiShadowEnabled === true);
      setInvoiceTrainingPasswordConfigured(
        settings.invoiceTrainingAdminPasswordConfigured === true,
      );
    });
    void getInvoiceTrainingAdminStatus()
      .then((status) => {
        setInvoiceTrainingAlertEmail(status.alertEmail ?? "");
        setInvoiceTrainingPasswordConfigured(status.passwordConfigured);
      })
      .catch(() => {
        /* status callable optional on first load */
      });
  }, []);

  useEffect(() => {
    const hash = location.hash;
    const queryStart = hash.indexOf("?");
    if (queryStart === -1) return;
    const params = new URLSearchParams(hash.slice(queryStart + 1));
    if (params.get("focus") !== "invoice-training-admin") return;
    const el = document.getElementById("settings-invoice-training-admin");
    if (!el) return;
    window.setTimeout(() => {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      el.style.outline = `2px solid ${NAVY}`;
      window.setTimeout(() => {
        el.style.outline = "";
      }, 2500);
    }, 80);
  }, [location.hash]);

  const syncConnectedMailboxToSettings = async (
    connectedEmail: string,
  ): Promise<void> => {
    setMonitoringInboxEmail(connectedEmail);
    const settings = await getAppSettings();
    if (settings.monitoringInboxEmail !== connectedEmail) {
      await updateAppSettings({ monitoringInboxEmail: connectedEmail });
    }
  };

  const refreshGmailConnection = async () => {
    setLoadingGmailConnection(true);
    try {
      const connection = await getEmailProviderConnection();
      setGmailConnection(connection);
      if (
        connection?.connectedAccountEmail &&
        (connection.status === "connected" ||
          connection.status === "token_expired")
      ) {
        await syncConnectedMailboxToSettings(connection.connectedAccountEmail);
      }
    } catch {
      setGmailConnection(null);
    } finally {
      setLoadingGmailConnection(false);
    }
  };

  useEffect(() => {
    void refreshGmailConnection();
  }, []);

  useEffect(() => {
    const hash = location.hash;
    const queryStart = hash.indexOf("?");
    if (queryStart === -1) return;
    const params = new URLSearchParams(hash.slice(queryStart + 1));
    const oauthResult = params.get("gmailOAuth");
    if (!oauthResult) return;

    if (oauthResult === "success") {
      setGmailOAuthMessage("Gmail connected successfully.");
      void refreshGmailConnection();
    } else {
      const reason = params.get("reason") ?? "unknown";
      setGmailOAuthMessage(`Gmail connection failed (${reason}).`);
    }
    window.setTimeout(() => setGmailOAuthMessage(null), 6000);
  }, [location.hash]);

  const handleConnectGmail = async () => {
    if (connectingGmail) return;
    setConnectingGmail(true);
    setGmailOAuthMessage(null);
    try {
      const returnUrl = `${window.location.origin}${window.location.pathname}#/settings`;
      const authUrl = await initiateGmailOAuth(returnUrl);
      window.location.href = authUrl;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Could not start Gmail connection.";
      setGmailOAuthMessage(message);
      setConnectingGmail(false);
    }
  };

  const handleDisconnectGmail = async () => {
    if (disconnectingGmail) return;
    setDisconnectingGmail(true);
    setGmailOAuthMessage(null);
    try {
      await disconnectGmailOAuth();
      await refreshGmailConnection();
      setGmailOAuthMessage("Gmail disconnected.");
      window.setTimeout(() => setGmailOAuthMessage(null), 4000);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Could not disconnect Gmail.";
      setGmailOAuthMessage(message);
    } finally {
      setDisconnectingGmail(false);
    }
  };

  const gmailStatus = gmailConnection?.status ?? "disconnected";
  const linkedMailboxEmail = gmailConnection?.connectedAccountEmail ?? "";
  const hasLinkedMailbox =
    linkedMailboxEmail.length > 0 &&
    (gmailStatus === "connected" || gmailStatus === "token_expired");
  const gmailStatusLabel =
    gmailStatus === "connected"
      ? "Connected"
      : gmailStatus === "token_expired"
        ? "Token expired"
        : "Disconnected";
  const gmailStatusColor =
    gmailStatus === "connected"
      ? "#166534"
      : gmailStatus === "token_expired"
        ? "#b45309"
        : "#6b7280";
  const gmailStatusBg =
    gmailStatus === "connected"
      ? "#dcfce7"
      : gmailStatus === "token_expired"
        ? "#fef3c7"
        : "#f3f4f6";

  const saveEmailSettings = async () => {
    if (savingEmail) return;
    setSavingEmail(true);
    try {
      const inboxEmail = hasLinkedMailbox
        ? linkedMailboxEmail
        : monitoringInboxEmail.trim();
      await updateAppSettings({
        monitoringInboxEmail: inboxEmail,
        emailMonitoringEnabled,
        invoiceAiShadowEnabled,
      });
      if (hasLinkedMailbox) {
        setMonitoringInboxEmail(linkedMailboxEmail);
      }
      setEmailSaved(true);
      setTimeout(() => setEmailSaved(false), 2000);
    } finally {
      setSavingEmail(false);
    }
  };

  const saveInvoiceTrainingAdmin = async () => {
    if (savingTrainingAdmin) return;
    setSavingTrainingAdmin(true);
    setTrainingAdminError(null);
    try {
      const result = await configureInvoiceTrainingAdmin({
        alertEmail: invoiceTrainingAlertEmail.trim(),
        password: invoiceTrainingAdminPassword,
      });
      setInvoiceTrainingAlertEmail(result.alertEmail ?? invoiceTrainingAlertEmail);
      setInvoiceTrainingPasswordConfigured(true);
      setInvoiceTrainingAdminPassword("");
      setTrainingAdminSaved(true);
      window.setTimeout(() => setTrainingAdminSaved(false), 2500);
    } catch (err) {
      setTrainingAdminError(
        err instanceof Error ? err.message : "Could not save Admin settings.",
      );
    } finally {
      setSavingTrainingAdmin(false);
    }
  };

  const saveRevertWindow = async () => {
    if (savingRevert) return;
    setSavingRevert(true);
    try {
      const patch: Partial<AppSettings> = {
        vendorRevertWindowMinutes: revertWindowMinutes,
        vendorDeliveryMode,
        vendorSessionMinutes,
        vendorGeofenceEnforce,
      };
      const lat = Number(shopLatitude);
      const lng = Number(shopLongitude);
      const radius = Number(shopGeofenceRadiusMeters);
      if (shopLatitude.trim() && Number.isFinite(lat)) patch.shopLatitude = lat;
      if (shopLongitude.trim() && Number.isFinite(lng)) patch.shopLongitude = lng;
      if (shopGeofenceRadiusMeters.trim() && Number.isFinite(radius) && radius > 0) {
        patch.shopGeofenceRadiusMeters = radius;
      }
      await updateAppSettings(patch);
      setRevertSaved(true);
      setTimeout(() => setRevertSaved(false), 2000);
    } finally {
      setSavingRevert(false);
    }
  };

  const cardStyle = {
    backgroundColor: "var(--color-panel-bg)",
    border: "1px solid var(--color-border)",
    borderRadius: 16,
    boxShadow: "0 12px 40px rgba(0,0,0,0.18), 0 0 0 1px var(--color-glow)",
  };

  const startEditSpot = (spot: StagingLocation) => {
    setEditingSpotId(spot.id);
    setEditForm(spotToEditForm(spot));
    setEditError(null);
  };

  const cancelEditSpot = () => {
    setEditingSpotId(null);
    setEditForm(null);
    setEditError(null);
  };

  const saveEditSpot = async (spot: StagingLocation) => {
    if (editingSpotId !== spot.id || !editForm || savingEdit) return;

    const label = editForm.label.trim();
    if (!editForm.code.trim() || !label) return;

    const canonicalCode = formatStagingCodeCanonical(editForm.code);
    if (findOtherSpotByCode(allZones, editForm.code, spot.id)) {
      setEditError(`Spot code "${canonicalCode}" is already used.`);
      return;
    }

    setSavingEdit(true);
    setEditError(null);

    try {
      const sortOrder = editForm.sortOrder.trim()
        ? Number(editForm.sortOrder)
        : undefined;
      const patch = {
        code: canonicalCode,
        label,
        type: editForm.type,
        status: editForm.status,
        sortOrder: Number.isFinite(sortOrder) ? sortOrder : undefined,
      };
      const mapLayoutSlot = formatStagingCodeCanonical(
        spot.mapLayoutSlot ?? spot.code,
      );

      if (isMapSlotPlaceholderStagingLocation(spot)) {
        const id = await createZone({
          ...patch,
          mapLayoutSlot,
          sortOrder: patch.sortOrder,
        });
        setAllZones((prev) => [
          ...prev,
          {
            id,
            ...patch,
            mapLayoutSlot,
          },
        ]);
      } else {
        await updateZone(spot.id, { ...patch, mapLayoutSlot });
        setAllZones((prev) =>
          prev.map((s) =>
            s.id === spot.id ? { ...s, ...patch, mapLayoutSlot, id: spot.id } : s,
          ),
        );
      }
      cancelEditSpot();
    } catch (err) {
      setEditError(
        err instanceof Error ? err.message : "Failed to save staging spot.",
      );
    } finally {
      setSavingEdit(false);
    }
  };

  const inputStyle: CSSProperties = {
    width: "100%",
    padding: "10px 12px",
    border: "1.5px solid var(--color-border)",
    borderRadius: 6,
    fontSize: 14,
    color: "var(--color-panel-text)",
    outline: "none",
    backgroundColor: "var(--color-panel-input-bg)",
    fontFamily: FONT,
    boxSizing: "border-box",
  };

  const labelStyle: CSSProperties = {
    display: "block",
    fontSize: 13,
    fontWeight: 700,
    color: "var(--color-panel-muted)",
    marginBottom: 6,
  };

  if (portalNavFocus(location.search) === "vendors") {
    return <Navigate to="/vendors" replace />;
  }

  return (
    <div style={{ fontFamily: FONT }} className={PORTAL_SHELL_CLASS}>
      <PortalSidebar />
      {/* Main content */}
      <div
        className={PORTAL_MAIN_CLASS}
        style={{ backgroundColor: "var(--color-bg-primary)" }}
      >
        <DispatcherPortalTopBar
          title="Settings"
          subtitle="Configuration"
          lastUpdated={lastUpdated}
          refreshBusy={refreshBusy}
          gmailSyncMessage={gmailSyncMessage}
          onRefreshNow={handleRefreshNow}
        />

        <div
          className={PORTAL_SCROLL_CLASS}
          style={{ backgroundColor: "var(--color-bg-primary)" }}
        >
        <div
          style={{
            padding: "30px",
            display: "flex",
            flexDirection: "column",
            gap: 16,
            width: "100%",
            maxWidth: 1440,
            margin: "0 auto",
          }}
        >
          <div>
            <h1
              style={{
                fontSize: 24,
                fontWeight: 700,
                color: NAVY,
                margin: 0,
                lineHeight: "1.2",
              }}
            >
              Settings
            </h1>
            <p style={{ fontSize: 13, color: "#6b7280", marginTop: 4 }}>
              Manage staging spots and workflow configuration.
            </p>
          </div>

          {/* Workflow settings */}
          <div style={{ ...cardStyle, overflow: "hidden" }}>
            <div
              style={{
                padding: "15px 20px",
                borderBottom: "1px solid #eaecf0",
              }}
            >
              <span style={{ fontWeight: 700, fontSize: 15, color: NAVY }}>
                Workflow
              </span>
            </div>
            <div
              style={{
                padding: "20px",
                display: "flex",
                alignItems: "center",
                gap: 12,
                flexWrap: "wrap",
              }}
            >
              <label
                style={{
                  fontSize: 13,
                  fontWeight: 700,
                  color: "#6b7280",
                  whiteSpace: "nowrap",
                }}
              >
                Vendor auto-save
              </label>
              <input
                type="number"
                min={1}
                value={revertWindowMinutes}
                onChange={(e) =>
                  setRevertWindowMinutes(Number(e.target.value) || 0)
                }
                onBlur={() => void saveRevertWindow()}
                style={{
                  width: 80,
                  padding: "10px 12px",
                  border: "1.5px solid #ccd0d7",
                  borderRadius: 6,
                  fontSize: 14,
                  color: "var(--color-panel-text)",
                  outline: "none",
                  backgroundColor: "var(--color-panel-bg)",
                  fontFamily: FONT,
                  boxSizing: "border-box",
                }}
              />
              <span style={{ fontSize: 13, color: "#6b7280" }}>minutes</span>
              <label
                style={{
                  fontSize: 13,
                  fontWeight: 700,
                  color: "#6b7280",
                  whiteSpace: "nowrap",
                  marginLeft: 8,
                }}
              >
                Vendor session TTL
              </label>
              <input
                type="number"
                min={5}
                max={480}
                value={vendorSessionMinutes}
                onChange={(e) =>
                  setVendorSessionMinutes(Number(e.target.value) || 15)
                }
                onBlur={() => void saveRevertWindow()}
                style={{
                  width: 80,
                  padding: "10px 12px",
                  border: "1.5px solid #ccd0d7",
                  borderRadius: 6,
                  fontSize: 14,
                  color: "var(--color-panel-text)",
                  outline: "none",
                  backgroundColor: "var(--color-panel-bg)",
                  fontFamily: FONT,
                  boxSizing: "border-box",
                }}
              />
              <span style={{ fontSize: 13, color: "#6b7280" }}>
                min (PIN re-prompt)
              </span>
              <label
                style={{
                  fontSize: 13,
                  fontWeight: 700,
                  color: "#6b7280",
                  whiteSpace: "nowrap",
                  marginLeft: 8,
                }}
              >
                Vendor delivery mode
              </label>
              <select
                value={vendorDeliveryMode}
                onChange={(e) =>
                  setVendorDeliveryMode(
                    e.target.value as VendorDeliveryMode,
                  )
                }
                onBlur={() => void saveRevertWindow()}
                style={{
                  padding: "10px 12px",
                  border: "1.5px solid #ccd0d7",
                  borderRadius: 6,
                  fontSize: 14,
                  color: "var(--color-panel-text)",
                  backgroundColor: "var(--color-panel-bg)",
                  fontFamily: FONT,
                }}
              >
                <option value="full_checkin">Full check-in (legacy)</option>
                <option value="exception_only">Exception-only Delivered hub</option>
              </select>
              <button
                type="button"
                onClick={() => void saveRevertWindow()}
                disabled={savingRevert}
                style={{
                  padding: "8px 18px",
                  borderRadius: 4,
                  border: "none",
                  backgroundColor: savingRevert ? "var(--color-bg-surface)" : NAVY,
                  color: savingRevert ? "#9ca3af" : "#fff",
                  fontWeight: 700,
                  fontSize: 13,
                  cursor: savingRevert ? "not-allowed" : "pointer",
                  fontFamily: FONT,
                  outline: "none",
                }}
              >
                Save
              </button>
              {revertSaved && (
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: "#2e7d32",
                  }}
                >
                  Saved ✓
                </span>
              )}
            </div>
            <div
              style={{
                padding: "0 20px 20px",
                display: "flex",
                flexWrap: "wrap",
                gap: 12,
                alignItems: "center",
              }}
            >
              <span
                style={{
                  fontSize: 13,
                  fontWeight: 700,
                  color: "#6b7280",
                  width: "100%",
                }}
              >
                Shop geofence (vendor receive warn)
              </span>
              <label style={{ fontSize: 13, color: "#6b7280" }}>Lat</label>
              <input
                type="text"
                value={shopLatitude}
                onChange={(e) => setShopLatitude(e.target.value)}
                onBlur={() => void saveRevertWindow()}
                placeholder="41.88"
                style={{
                  width: 100,
                  padding: "8px 10px",
                  border: "1.5px solid #ccd0d7",
                  borderRadius: 6,
                  fontSize: 14,
                  fontFamily: FONT,
                }}
              />
              <label style={{ fontSize: 13, color: "#6b7280" }}>Lng</label>
              <input
                type="text"
                value={shopLongitude}
                onChange={(e) => setShopLongitude(e.target.value)}
                onBlur={() => void saveRevertWindow()}
                placeholder="-87.63"
                style={{
                  width: 100,
                  padding: "8px 10px",
                  border: "1.5px solid #ccd0d7",
                  borderRadius: 6,
                  fontSize: 14,
                  fontFamily: FONT,
                }}
              />
              <label style={{ fontSize: 13, color: "#6b7280" }}>Radius (m)</label>
              <input
                type="number"
                min={50}
                value={shopGeofenceRadiusMeters}
                onChange={(e) => setShopGeofenceRadiusMeters(e.target.value)}
                onBlur={() => void saveRevertWindow()}
                placeholder="402"
                style={{
                  width: 80,
                  padding: "8px 10px",
                  border: "1.5px solid #ccd0d7",
                  borderRadius: 6,
                  fontSize: 14,
                  fontFamily: FONT,
                }}
              />
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 13,
                  color: "#6b7280",
                  cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={vendorGeofenceEnforce}
                  onChange={(e) => {
                    setVendorGeofenceEnforce(e.target.checked);
                    void saveRevertWindow();
                  }}
                />
                Block DELIVERED outside radius
              </label>
            </div>
          </div>

          {/* Email monitoring */}
          <div style={{ ...cardStyle, overflow: "hidden" }}>
            <div
              style={{
                padding: "15px 20px",
                borderBottom: "1px solid #eaecf0",
              }}
            >
              <span style={{ fontWeight: 700, fontSize: 15, color: NAVY }}>
                Email Monitoring
              </span>
            </div>
            <div style={{ padding: "20px" }}>
              {hasLinkedMailbox ? (
                <>
                  <div
                    style={{
                      padding: "14px 16px",
                      borderRadius: 8,
                      border: "1px solid #e5e7eb",
                      backgroundColor: "var(--color-bg-surface)",
                      maxWidth: 560,
                      marginBottom: 16,
                    }}
                  >
                    <div
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        color: NAVY,
                        marginBottom: 12,
                        letterSpacing: "0.02em",
                      }}
                    >
                      Gmail Mailbox
                    </div>
                    <div style={{ marginBottom: 12 }}>
                      <div style={labelStyle}>Connected mailbox</div>
                      <div
                        data-testid="gmail-connected-account"
                        style={{
                          fontSize: 14,
                          fontWeight: 600,
                          color: "#374151",
                        }}
                      >
                        {linkedMailboxEmail}
                      </div>
                    </div>
                    <div
                      style={{
                        display: "flex",
                        flexWrap: "wrap",
                        gap: 16,
                        alignItems: "center",
                        marginBottom: 12,
                      }}
                    >
                      <div>
                        <div
                          style={{
                            fontSize: 11,
                            fontWeight: 700,
                            color: "#6b7280",
                            marginBottom: 4,
                          }}
                        >
                          Status
                        </div>
                        <span
                          data-testid="gmail-oauth-status-badge"
                          data-status={gmailStatus}
                          style={{
                            display: "inline-block",
                            padding: "4px 10px",
                            borderRadius: 999,
                            fontSize: 12,
                            fontWeight: 700,
                            color: gmailStatusColor,
                            backgroundColor: gmailStatusBg,
                          }}
                        >
                          {loadingGmailConnection ? "Loading…" : gmailStatusLabel}
                        </span>
                      </div>
                      <div>
                        <div
                          style={{
                            fontSize: 11,
                            fontWeight: 700,
                            color: "#6b7280",
                            marginBottom: 4,
                          }}
                        >
                          Monitoring
                        </div>
                        <span
                          data-testid="email-monitoring-status-label"
                          style={{
                            fontSize: 13,
                            fontWeight: 600,
                            color: emailMonitoringEnabled ? "#166534" : "#6b7280",
                          }}
                        >
                          {emailMonitoringEnabled ? "Enabled" : "Disabled"}
                        </span>
                      </div>
                    </div>
                    <p
                      style={{
                        margin: "0 0 14px",
                        fontSize: 12,
                        color: "#6b7280",
                        lineHeight: 1.45,
                      }}
                    >
                      StageVerify monitors the connected Gmail mailbox for vendor
                      emails. CC or forward vendor order emails to{" "}
                      <strong>{STAGEVERIFY_BOT_INBOX}</strong> (recommended ingest inbox).
                    </p>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {gmailStatus === "token_expired" && (
                        <button
                          type="button"
                          data-testid="gmail-oauth-connect"
                          onClick={() => void handleConnectGmail()}
                          disabled={connectingGmail || loadingGmailConnection}
                          style={{
                            padding: "8px 16px",
                            borderRadius: 4,
                            border: "none",
                            backgroundColor:
                              connectingGmail || loadingGmailConnection
                                ? "#e5e7eb"
                                : NAVY,
                            color:
                              connectingGmail || loadingGmailConnection
                                ? "#9ca3af"
                                : "var(--color-panel-bg)",
                            fontWeight: 700,
                            fontSize: 13,
                            cursor:
                              connectingGmail || loadingGmailConnection
                                ? "not-allowed"
                                : "pointer",
                            fontFamily: FONT,
                          }}
                        >
                          {connectingGmail ? "Redirecting…" : "Reconnect Gmail"}
                        </button>
                      )}
                      {gmailStatus === "connected" && (
                        <button
                          type="button"
                          data-testid="gmail-oauth-disconnect"
                          onClick={() => void handleDisconnectGmail()}
                          disabled={disconnectingGmail}
                          style={{
                            padding: "8px 16px",
                            borderRadius: 4,
                            border: "1px solid #d1d5db",
                            backgroundColor: disconnectingGmail ? "#f3f4f6" : "var(--color-panel-bg)",
                            color: disconnectingGmail ? "#9ca3af" : "#374151",
                            fontWeight: 700,
                            fontSize: 13,
                            cursor: disconnectingGmail ? "not-allowed" : "pointer",
                            fontFamily: FONT,
                          }}
                        >
                          {disconnectingGmail ? "Disconnecting…" : "Disconnect"}
                        </button>
                      )}
                    </div>
                  </div>
                  {gmailOAuthMessage && (
                    <p
                      data-testid="gmail-oauth-message"
                      style={{
                        margin: "0 0 14px",
                        fontSize: 12,
                        color: gmailOAuthMessage.includes("failed")
                          ? "#b91c1c"
                          : "#166534",
                        maxWidth: 560,
                      }}
                    >
                      {gmailOAuthMessage}
                    </p>
                  )}
                  <label
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: 8,
                      fontSize: 13,
                      fontWeight: 600,
                      color: "#374151",
                      cursor: "pointer",
                      maxWidth: 560,
                    }}
                  >
                    <input
                      type="checkbox"
                      data-testid="email-monitoring-enabled"
                      checked={emailMonitoringEnabled}
                      onChange={(e) => setEmailMonitoringEnabled(e.target.checked)}
                      style={{ marginTop: 2 }}
                    />
                    <span>
                      Process vendor emails from this mailbox
                      <span
                        style={{
                          display: "block",
                          fontSize: 11,
                          fontWeight: 500,
                          color: "#9ca3af",
                          marginTop: 4,
                          lineHeight: 1.45,
                        }}
                      >
                        Controls whether StageVerify ingests and processes emails —
                        not the mailbox address.
                      </span>
                    </span>
                  </label>
                  <label
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: 8,
                      fontSize: 13,
                      fontWeight: 600,
                      color: "#374151",
                      cursor: "pointer",
                      maxWidth: 560,
                      marginTop: 12,
                    }}
                  >
                    <input
                      type="checkbox"
                      data-testid="invoice-ai-shadow-enabled"
                      checked={invoiceAiShadowEnabled}
                      onChange={(e) => setInvoiceAiShadowEnabled(e.target.checked)}
                      style={{ marginTop: 2 }}
                    />
                    <span>
                      Johnstone invoice AI shadow (Vertex)
                      <span
                        style={{
                          display: "block",
                          fontSize: 11,
                          fontWeight: 500,
                          color: "#6b7280",
                          marginTop: 4,
                          lineHeight: 1.45,
                        }}
                      >
                        Runs Gemini Flash-Lite, then always validates with 3.6 Flash
                        after the regex parser. Logs results only — never auto-approves.
                      </span>
                    </span>
                  </label>
                  <div
                    id="settings-invoice-training-admin"
                    data-testid="settings-invoice-training-admin"
                    style={{
                      marginTop: 20,
                      padding: "16px 16px 14px",
                      border: "1px solid #d1d5db",
                      borderRadius: 8,
                      backgroundColor: "var(--color-bg-surface)",
                      maxWidth: 560,
                    }}
                  >
                    <div
                      style={{
                        fontSize: 14,
                        fontWeight: 700,
                        color: NAVY,
                        marginBottom: 6,
                      }}
                    >
                      Invoice training Admin
                    </div>
                    <p
                      style={{
                        margin: "0 0 12px",
                        fontSize: 12,
                        color: "#4b5563",
                        lineHeight: 1.45,
                        fontWeight: 500,
                      }}
                    >
                      Alert email (safety-reject notifications) and Admin password
                      for editing vendor training playbooks. Dispatcher only. Password
                      is stored as a hash — never shown again.
                    </p>
                    <label
                      style={{
                        display: "block",
                        fontSize: 12,
                        fontWeight: 600,
                        color: "#374151",
                        marginBottom: 4,
                      }}
                    >
                      Alert email
                    </label>
                    <input
                      type="email"
                      data-testid="invoice-training-alert-email"
                      value={invoiceTrainingAlertEmail}
                      onChange={(e) => setInvoiceTrainingAlertEmail(e.target.value)}
                      placeholder="you@example.com"
                      style={{
                        display: "block",
                        width: "100%",
                        boxSizing: "border-box",
                        padding: "8px 10px",
                        border: "1px solid #cbd5e1",
                        borderRadius: 6,
                        fontSize: 13,
                        color: "#111827",
                        backgroundColor: "var(--color-panel-bg)",
                        marginBottom: 10,
                        fontFamily: FONT,
                      }}
                    />
                    <label
                      style={{
                        display: "block",
                        fontSize: 12,
                        fontWeight: 600,
                        color: "#374151",
                        marginBottom: 4,
                      }}
                    >
                      Admin password{" "}
                      {invoiceTrainingPasswordConfigured
                        ? "(set a new password to replace)"
                        : "(min 8 characters)"}
                    </label>
                    <input
                      type="password"
                      data-testid="invoice-training-admin-password"
                      value={invoiceTrainingAdminPassword}
                      onChange={(e) =>
                        setInvoiceTrainingAdminPassword(e.target.value)
                      }
                      placeholder={
                        invoiceTrainingPasswordConfigured
                          ? "Enter new password to change"
                          : "Create Admin password"
                      }
                      autoComplete="new-password"
                      style={{
                        display: "block",
                        width: "100%",
                        boxSizing: "border-box",
                        padding: "8px 10px",
                        border: "1px solid #cbd5e1",
                        borderRadius: 6,
                        fontSize: 13,
                        color: "#111827",
                        backgroundColor: "var(--color-panel-bg)",
                        marginBottom: 10,
                        fontFamily: FONT,
                      }}
                    />
                    <div
                      style={{
                        fontSize: 11,
                        color: invoiceTrainingPasswordConfigured
                          ? "#166534"
                          : "#b45309",
                        marginBottom: 10,
                        fontWeight: 600,
                      }}
                    >
                      {invoiceTrainingPasswordConfigured
                        ? "Password configured"
                        : "Password not configured yet"}
                      {" · "}
                      {invoiceTrainingAlertEmail.trim()
                        ? "Alert email set"
                        : "Alert email required"}
                    </div>
                    {trainingAdminError && (
                      <p
                        data-testid="invoice-training-admin-error"
                        style={{
                          margin: "0 0 8px",
                          fontSize: 12,
                          color: RED,
                          fontWeight: 600,
                        }}
                      >
                        {trainingAdminError}
                      </p>
                    )}
                    <button
                      type="button"
                      data-testid="save-invoice-training-admin"
                      onClick={() => void saveInvoiceTrainingAdmin()}
                      disabled={
                        savingTrainingAdmin ||
                        !invoiceTrainingAlertEmail.trim() ||
                        invoiceTrainingAdminPassword.length < 8
                      }
                      style={{
                        padding: "8px 18px",
                        borderRadius: 4,
                        border: "none",
                        backgroundColor:
                          savingTrainingAdmin ||
                          !invoiceTrainingAlertEmail.trim() ||
                          invoiceTrainingAdminPassword.length < 8
                            ? "#f3f4f6"
                            : NAVY,
                        color:
                          savingTrainingAdmin ||
                          !invoiceTrainingAlertEmail.trim() ||
                          invoiceTrainingAdminPassword.length < 8
                            ? "#9ca3af"
                            : "var(--color-panel-bg)",
                        fontWeight: 700,
                        fontSize: 13,
                        cursor:
                          savingTrainingAdmin ||
                          !invoiceTrainingAlertEmail.trim() ||
                          invoiceTrainingAdminPassword.length < 8
                            ? "not-allowed"
                            : "pointer",
                        fontFamily: FONT,
                      }}
                    >
                      {savingTrainingAdmin
                        ? "Saving…"
                        : trainingAdminSaved
                          ? "Saved"
                          : "Save Admin email & password"}
                    </button>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      marginTop: 14,
                    }}
                  >
                    <button
                      type="button"
                      data-testid="save-email-settings"
                      onClick={() => void saveEmailSettings()}
                      disabled={savingEmail}
                      style={{
                        padding: "8px 18px",
                        borderRadius: 4,
                        border: "none",
                        backgroundColor: savingEmail ? "var(--color-bg-surface)" : NAVY,
                        color: savingEmail ? "#9ca3af" : "#fff",
                        fontWeight: 700,
                        fontSize: 13,
                        cursor: savingEmail ? "not-allowed" : "pointer",
                        fontFamily: FONT,
                        outline: "none",
                      }}
                    >
                      Save
                    </button>
                    {emailSaved && (
                      <span
                        data-testid="email-settings-saved"
                        style={{
                          fontSize: 13,
                          fontWeight: 600,
                          color: "#2e7d32",
                        }}
                      >
                        Saved ✓
                      </span>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <p
                    style={{
                      margin: "0 0 16px",
                      fontSize: 12,
                      color: "#6b7280",
                      lineHeight: 1.45,
                      maxWidth: 560,
                    }}
                  >
                    Connect Gmail for vendor email send/receive. Recommended monitoring inbox:{" "}
                    <strong>{STAGEVERIFY_BOT_INBOX}</strong>. Set an address below, or connect
                    first — the connected account becomes the monitored mailbox.
                  </p>
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      alignItems: "center",
                      gap: 12,
                      marginBottom: 16,
                      padding: "12px 14px",
                      borderRadius: 8,
                      border: "1px solid #e5e7eb",
                      backgroundColor: "var(--color-bg-surface)",
                      maxWidth: 560,
                    }}
                  >
                    <div style={{ flex: "1 1 180px" }}>
                      <div
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          color: NAVY,
                          marginBottom: 6,
                          letterSpacing: "0.02em",
                        }}
                      >
                        Gmail provider
                      </div>
                      <span
                        data-testid="gmail-oauth-status-badge"
                        data-status={gmailStatus}
                        style={{
                          display: "inline-block",
                          padding: "4px 10px",
                          borderRadius: 999,
                          fontSize: 12,
                          fontWeight: 700,
                          color: gmailStatusColor,
                          backgroundColor: gmailStatusBg,
                        }}
                      >
                        {loadingGmailConnection ? "Loading…" : gmailStatusLabel}
                      </span>
                    </div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <button
                        type="button"
                        data-testid="gmail-oauth-connect"
                        onClick={() => void handleConnectGmail()}
                        disabled={connectingGmail || loadingGmailConnection}
                        style={{
                          padding: "8px 16px",
                          borderRadius: 4,
                          border: "none",
                          backgroundColor:
                            connectingGmail || loadingGmailConnection ? "#e5e7eb" : NAVY,
                          color:
                            connectingGmail || loadingGmailConnection ? "#9ca3af" : "var(--color-panel-bg)",
                          fontWeight: 700,
                          fontSize: 13,
                          cursor:
                            connectingGmail || loadingGmailConnection
                              ? "not-allowed"
                              : "pointer",
                          fontFamily: FONT,
                        }}
                      >
                        {connectingGmail ? "Redirecting…" : "Connect Gmail"}
                      </button>
                    </div>
                  </div>
                  {gmailOAuthMessage && (
                    <p
                      data-testid="gmail-oauth-message"
                      style={{
                        margin: "0 0 14px",
                        fontSize: 12,
                        color: gmailOAuthMessage.includes("failed") ? "#b91c1c" : "#166534",
                        maxWidth: 560,
                      }}
                    >
                      {gmailOAuthMessage}
                    </p>
                  )}
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "minmax(200px, 1fr) auto",
                      gap: 12,
                      alignItems: "end",
                      maxWidth: 560,
                    }}
                  >
                    <div>
                      <label style={labelStyle} htmlFor="monitoring-inbox-email">
                        Monitoring inbox address
                      </label>
                      <input
                        id="monitoring-inbox-email"
                        data-testid="monitoring-inbox-email"
                        type="email"
                        value={monitoringInboxEmail}
                        onChange={(e) => setMonitoringInboxEmail(e.target.value)}
                        placeholder={STAGEVERIFY_BOT_INBOX}
                        style={inputStyle}
                      />
                    </div>
                    <label
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        fontSize: 13,
                        fontWeight: 600,
                        color: "#374151",
                        cursor: "pointer",
                        paddingBottom: 10,
                        whiteSpace: "nowrap",
                      }}
                    >
                      <input
                        type="checkbox"
                        data-testid="email-monitoring-enabled"
                        checked={emailMonitoringEnabled}
                        onChange={(e) => setEmailMonitoringEnabled(e.target.checked)}
                      />
                      Enable monitoring
                    </label>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      marginTop: 14,
                    }}
                  >
                    <button
                      type="button"
                      data-testid="save-email-settings"
                      onClick={() => void saveEmailSettings()}
                      disabled={savingEmail}
                      style={{
                        padding: "8px 18px",
                        borderRadius: 4,
                        border: "none",
                        backgroundColor: savingEmail ? "var(--color-bg-surface)" : NAVY,
                        color: savingEmail ? "#9ca3af" : "#fff",
                        fontWeight: 700,
                        fontSize: 13,
                        cursor: savingEmail ? "not-allowed" : "pointer",
                        fontFamily: FONT,
                        outline: "none",
                      }}
                    >
                      Save
                    </button>
                    {emailSaved && (
                      <span
                        data-testid="email-settings-saved"
                        style={{
                          fontSize: 13,
                          fontWeight: 600,
                          color: "#2e7d32",
                        }}
                      >
                        Saved ✓
                      </span>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>

          <TechnicianSettingsPanel />

          <OfficeReceiversSettingsPanel />

          <div style={{ ...cardStyle, overflow: "hidden", marginTop: 16 }}>
            <ManagementSettingsPanel />
          </div>

          {/* Staging spots — map-synced list only (D-52) */}
          <div
            style={{ ...cardStyle, overflow: "hidden" }}
            data-testid="settings-staging-spots-section"
          >
            <div
              style={{
                padding: "15px 20px",
                borderBottom: "1px solid #eaecf0",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                flexWrap: "wrap",
              }}
            >
              <div>
                <span style={{ fontWeight: 700, fontSize: 15, color: NAVY }}>
                  Staging Spots
                </span>
                {!loadingSpots && (
                  <span
                    style={{
                      marginLeft: 8,
                      fontSize: 12,
                      color: "#9ca3af",
                      fontWeight: 500,
                    }}
                  >
                    {stagingSpots.length}{" "}
                    {stagingSpots.length === 1 ? "spot" : "spots"} on map
                  </span>
                )}
              </div>
              <Link
                to="/zones"
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: NAVY,
                  textDecoration: "none",
                  whiteSpace: "nowrap",
                }}
              >
                Zone map &amp; QR labels →
              </Link>
            </div>
            <div style={{ padding: "20px" }}>
              <p
                style={{
                  margin: "0 0 16px",
                  fontSize: 12,
                  color: "#6b7280",
                  lineHeight: 1.45,
                  maxWidth: 560,
                }}
              >
                Spots on the Staging Map appear here — add or remove spots on{" "}
                <Link to="/zones" style={{ color: NAVY, fontWeight: 600 }}>
                  Staging Map
                </Link>{" "}
                (Edit Locations). Use <strong style={{ fontWeight: 700 }}>Edit</strong>{" "}
                below to change label, type, status, or sort order for a mapped spot.
              </p>

              <p
                style={{
                  margin: "0 0 10px",
                  fontSize: 12,
                  fontWeight: 700,
                  color: "#374151",
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                }}
              >
                On Staging Map
              </p>

              {loadingSpots ? (
                <p style={{ fontSize: 13, color: "#9ca3af", margin: "0 0 16px" }}>
                  Loading spots…
                </p>
              ) : stagingSpots.length === 0 ? (
                <p
                  style={{
                    fontSize: 13,
                    color: "#9ca3af",
                    margin: "0 0 16px",
                    padding: "12px 14px",
                    backgroundColor: "var(--color-bg-surface)",
                    border: "1px solid #eaecf0",
                    borderRadius: 6,
                  }}
                >
                  No staging spots on the map yet. Open{" "}
                  <Link to="/zones" style={{ color: NAVY, fontWeight: 600 }}>
                    Staging Map
                  </Link>{" "}
                  → Edit Locations to add ground or shelf spots.
                </p>
              ) : (
                <div
                  style={{
                    overflowX: "auto",
                    marginBottom: 12,
                    border: "1px solid #eaecf0",
                    borderRadius: 6,
                  }}
                >
                  <table
                    style={{
                      width: "100%",
                      minWidth: 420,
                      borderCollapse: "collapse",
                      fontSize: 13,
                      fontFamily: FONT,
                    }}
                  >
                    <thead>
                      <tr style={{ backgroundColor: NAVY }}>
                        {["Code", "Label", "Type", "Status", "Sort", ""].map(
                          (col, i) => (
                            <th
                              key={i}
                              style={{
                                padding: "12px",
                                fontWeight: 700,
                                fontSize: 14,
                                color: "#ffffff",
                                textAlign: "left",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {col}
                            </th>
                          ),
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {stagingSpotRows.map((row, idx) => {
                        const spot = row.spot;
                        const rowKey = row.layoutSlot;
                        const rowTestCode =
                          spot.mapLayoutSlot ?? row.layoutSlot ?? spot.code;
                        const isEditing = editingSpotId === spot.id;
                        const rowBg = idx % 2 === 0 ? "var(--color-panel-bg)" : "var(--color-bg-surface)";
                        const tdBase: CSSProperties = {
                          padding: "10px 12px",
                          borderBottom: "1px solid #eaecf0",
                          verticalAlign: "middle",
                        };
                        const inlineInput: CSSProperties = {
                          padding: "4px 8px",
                          border: "1.5px solid #ccd0d7",
                          borderRadius: 4,
                          fontSize: 13,
                          color: "var(--color-panel-text)",
                          fontFamily: FONT,
                          outline: "none",
                          width: "100%",
                          boxSizing: "border-box",
                          backgroundColor: "var(--color-panel-bg)",
                        };
                        const rowConflict =
                          isEditing &&
                          editForm &&
                          findOtherSpotByCode(
                            stagingSpots,
                            editForm.code,
                            spot.id,
                          ) !== undefined;
                        const saveDisabled =
                          savingEdit ||
                          !editForm?.code.trim() ||
                          !editForm?.label.trim() ||
                          Boolean(rowConflict);

                        return (
                          <tr key={rowKey} style={{ backgroundColor: rowBg }}>
                            <td
                              style={{
                                ...tdBase,
                                fontWeight: 700,
                                fontFamily: "monospace",
                                color: NAVY,
                              }}
                            >
                              {isEditing && editForm ? (
                                <input
                                  style={{
                                    ...inlineInput,
                                    border: rowConflict
                                      ? `1.5px solid ${RED}`
                                      : inlineInput.border,
                                  }}
                                  value={editForm.code}
                                  onChange={(e) => {
                                    setEditForm((f) =>
                                      f ? { ...f, code: e.target.value } : f,
                                    );
                                    setEditError(null);
                                  }}
                                  autoFocus
                                />
                              ) : (
                                spot.code
                              )}
                            </td>
                            <td
                              data-testid={`spot-label-${spot.code}`}
                              style={{ ...tdBase, color: "var(--color-panel-text)" }}
                            >
                              {isEditing && editForm ? (
                                <input
                                  data-testid="edit-spot-label"
                                  style={inlineInput}
                                  value={editForm.label}
                                  onChange={(e) => {
                                    setEditForm((f) =>
                                      f ? { ...f, label: e.target.value } : f,
                                    );
                                    setEditError(null);
                                  }}
                                />
                              ) : (
                                spot.label
                              )}
                            </td>
                            <td style={{ ...tdBase, color: "var(--color-panel-text)" }}>
                              {isEditing && editForm ? (
                                <select
                                  style={inlineInput}
                                  value={editForm.type}
                                  onChange={(e) =>
                                    setEditForm((f) =>
                                      f
                                        ? {
                                            ...f,
                                            type: e.target
                                              .value as StagingSpotType,
                                          }
                                        : f,
                                    )
                                  }
                                >
                                  {STAGING_SPOT_TYPES.map((t) => (
                                    <option key={t} value={t}>
                                      {STAGING_TYPE_LABELS[t]}
                                    </option>
                                  ))}
                                </select>
                              ) : (
                                STAGING_TYPE_LABELS[spot.type]
                              )}
                            </td>
                            <td style={{ ...tdBase, color: "var(--color-panel-text)" }}>
                              {isEditing && editForm ? (
                                <select
                                  style={inlineInput}
                                  value={editForm.status}
                                  onChange={(e) =>
                                    setEditForm((f) =>
                                      f
                                        ? {
                                            ...f,
                                            status: e.target
                                              .value as LocationStatus,
                                          }
                                        : f,
                                    )
                                  }
                                >
                                  {LOCATION_STATUSES.map((s) => (
                                    <option key={s} value={s}>
                                      {LOCATION_STATUS_LABEL[s]}
                                    </option>
                                  ))}
                                </select>
                              ) : (
                                <span
                                  style={{
                                    color:
                                      spot.status === "Active"
                                        ? "#2e7d32"
                                        : "#6b7280",
                                    fontWeight: 600,
                                  }}
                                >
                                  {spot.status}
                                </span>
                              )}
                            </td>
                            <td style={{ ...tdBase, color: "var(--color-panel-text)" }}>
                              {isEditing && editForm ? (
                                <input
                                  type="number"
                                  min={0}
                                  style={{ ...inlineInput, width: 72 }}
                                  value={editForm.sortOrder}
                                  onChange={(e) =>
                                    setEditForm((f) =>
                                      f
                                        ? { ...f, sortOrder: e.target.value }
                                        : f,
                                    )
                                  }
                                  placeholder="—"
                                />
                              ) : spot.sortOrder != null ? (
                                spot.sortOrder
                              ) : (
                                "—"
                              )}
                            </td>
                            <td style={{ ...tdBase, whiteSpace: "nowrap" }}>
                              {isEditing ? (
                                <div style={{ display: "flex", gap: 6 }}>
                                  <button
                                    type="button"
                                    data-testid={`save-spot-${spot.code}`}
                                    onClick={() => void saveEditSpot(spot)}
                                    disabled={saveDisabled}
                                    style={{
                                      padding: "3px 10px",
                                      borderRadius: 4,
                                      border: "none",
                                      backgroundColor: saveDisabled
                                        ? "#e5e7eb"
                                        : NAVY,
                                      color: saveDisabled ? "#9ca3af" : "var(--color-panel-bg)",
                                      fontSize: 12,
                                      fontWeight: 600,
                                      cursor: saveDisabled
                                        ? "not-allowed"
                                        : "pointer",
                                      fontFamily: FONT,
                                    }}
                                  >
                                    {savingEdit ? "Saving…" : "Save"}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={cancelEditSpot}
                                    disabled={savingEdit}
                                    style={{
                                      padding: "3px 10px",
                                      borderRadius: 4,
                                      border: "1.5px solid #ccd0d7",
                                      backgroundColor: "var(--color-panel-bg)",
                                      color: "#6b7280",
                                      fontSize: 12,
                                      fontWeight: 600,
                                      cursor: savingEdit
                                        ? "not-allowed"
                                        : "pointer",
                                      fontFamily: FONT,
                                    }}
                                  >
                                    Cancel
                                  </button>
                                </div>
                              ) : (
                                <button
                                  type="button"
                                  data-testid={`edit-spot-${rowTestCode}`}
                                  onClick={() => startEditSpot(spot)}
                                  style={{
                                    padding: "3px 10px",
                                    borderRadius: 4,
                                    border: `1.5px solid ${NAVY}`,
                                    backgroundColor: "var(--color-panel-bg)",
                                    color: NAVY,
                                    fontSize: 12,
                                    fontWeight: 600,
                                    cursor: "pointer",
                                    fontFamily: FONT,
                                  }}
                                >
                                  Edit
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {editError && (
                <p
                  style={{
                    margin: "0 0 16px",
                    fontSize: 13,
                    color: RED,
                    fontWeight: 600,
                  }}
                >
                  {editError}
                </p>
              )}
            </div>
          </div>
        </div>
        </div>
      </div>
    </div>
  );
}
