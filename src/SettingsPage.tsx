import { useState, useEffect, useMemo, type CSSProperties } from "react";
import { Navigate, Link, useLocation } from "react-router-dom";
import {
  LOCATION_STATUSES,
  type LocationStatus,
  type StagingLocation,
  type VendorDeliveryMode,
  type AppSettings,
  type VendorIgnoreRule,
  type VendorIgnoreRuleStatus,
  type IgnoreRuleAuditEvent,
  type TrainingNoteAuditEntry,
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
  activateVendorIgnoreRule,
  archiveVendorIgnoreRule,
  getInvoiceTrainingAdminStatus,
  getMyDispatcherRole,
  listVendorIgnoreRules,
  listIgnoreRuleAuditEvents,
  listTrainingNoteAudit,
  migrateLegacyVendorIgnoreRules,
  bulkReopenImportsSkippedByRule,
  updateVendorIgnoreRule,
} from "./dispatcher/firestoreService";
import {
  stagingListRowsForShopMap,
  isMapSlotPlaceholderStagingLocation,
} from "./dispatcher/stagingMapSync";
import type { ShopMapLayoutExtras } from "./dispatcher/shopMapLayout";
import type { EmailProviderConnection } from "./dispatcher/models";
import { STAGEVERIFY_BOT_INBOX } from "./dispatcher/email/stageverifyBotInbox";
import { PortalShell } from "./PortalShell";
import {
  PORTAL_MAIN_CLASS,
  PORTAL_SCROLL_CLASS,
} from "./dispatcherPortalLayout";
import { portalNavFocus } from "./dispatcherPortalNav";
import { PortalSidebar } from "./PortalSidebar";
import { DispatcherPortalTopBar } from "./DispatcherPortalTopBar";
import { useDispatcherPortal } from "./dispatcher/DispatcherPortalContext";
import { PinAccessManagementPanel } from "./PinAccessManagementPanel";
import { OfficeReceiversSettingsPanel } from "./OfficeReceiversSettingsPanel";
import { ManagementSettingsPanel } from "./ManagementSettingsPanel";
import { DispatcherUsersSettingsPanel } from "./DispatcherUsersSettingsPanel";

const NAVY = "#0a3161";
const RED = "#bf0a30";
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
  /** YYYY-MM-DD or empty — maps to appSettings.stageVerifyActivatedAt */
  const [stageVerifyActivatedAt, setStageVerifyActivatedAt] = useState("");
  const [stageVerifyStartDateError, setStageVerifyStartDateError] = useState<
    string | null
  >(null);
  const [vendorSessionMinutes, setVendorSessionMinutes] = useState(15);
  const [technicianSessionMinutes, setTechnicianSessionMinutes] = useState(15);
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
  const [ignoreRulesPassword, setIgnoreRulesPassword] = useState("");
  const [ignoreRules, setIgnoreRules] = useState<VendorIgnoreRule[] | null>(
    null,
  );
  const [ignoreRulesLoading, setIgnoreRulesLoading] = useState(false);
  const [ignoreRulesError, setIgnoreRulesError] = useState<string | null>(null);
  const [ignoreRulesBusyKey, setIgnoreRulesBusyKey] = useState<string | null>(
    null,
  );
  const [showArchivedIgnoreRules, setShowArchivedIgnoreRules] = useState(false);
  const [ignoreRuleAuditKey, setIgnoreRuleAuditKey] = useState<string | null>(
    null,
  );
  const [ignoreRuleAuditEvents, setIgnoreRuleAuditEvents] = useState<
    IgnoreRuleAuditEvent[] | null
  >(null);
  const [ignoreRuleAuditLoading, setIgnoreRuleAuditLoading] = useState(false);
  const [legacyMigrationBusy, setLegacyMigrationBusy] = useState(false);
  const [bulkReopenBusyKey, setBulkReopenBusyKey] = useState<string | null>(
    null,
  );
  const [legacyMigrationMessage, setLegacyMigrationMessage] = useState<
    string | null
  >(null);
  const [activateDomainsDraft, setActivateDomainsDraft] = useState<
    Record<string, string>
  >({});
  const [isIgnoreRulesManager, setIsIgnoreRulesManager] = useState(false);
  const [trainingNoteAuditEntries, setTrainingNoteAuditEntries] = useState<
    TrainingNoteAuditEntry[] | null
  >(null);
  const [trainingNoteAuditLoading, setTrainingNoteAuditLoading] = useState(false);
  const [trainingNoteAuditError, setTrainingNoteAuditError] = useState<
    string | null
  >(null);
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
    void getMyDispatcherRole().then((role) => {
      setIsIgnoreRulesManager(role?.manager === true && role?.active !== false);
    });
  }, []);

  useEffect(() => {
    if (!lastUpdated) return;
    void listAllZones().then(setAllZones);
  }, [lastUpdated]);

  useEffect(() => {
    void getAppSettings().then((settings) => {
      setRevertWindowMinutes(settings.vendorRevertWindowMinutes);
      setVendorDeliveryMode(settings.vendorDeliveryMode ?? "full_checkin");
      const startDate = settings.stageVerifyActivatedAt?.trim() ?? "";
      setStageVerifyActivatedAt(
        /^\d{4}-\d{2}-\d{2}$/.test(startDate) ? startDate : "",
      );
      setStageVerifyStartDateError(null);
      setVendorSessionMinutes(settings.vendorSessionMinutes ?? 15);
      setTechnicianSessionMinutes(settings.technicianSessionMinutes ?? 15);
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
      el.style.outline = "2px solid #0a3161";
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
      ? "var(--admin-success-text)"
      : gmailStatus === "token_expired"
        ? "var(--admin-warning-text)"
        : "var(--admin-text-muted)";
  const gmailStatusBg =
    gmailStatus === "connected"
      ? "#dcfce7"
      : gmailStatus === "token_expired"
        ? "var(--admin-warning-bg)"
        : "var(--admin-surface-2)";

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

  const loadIgnoreRules = async () => {
    if (!ignoreRulesPassword.trim() || ignoreRulesLoading) return;
    setIgnoreRulesLoading(true);
    setIgnoreRulesError(null);
    try {
      const rules = await listVendorIgnoreRules({
        password: ignoreRulesPassword,
      });
      setIgnoreRules(rules);
    } catch (err) {
      setIgnoreRules(null);
      setIgnoreRulesError(
        err instanceof Error ? err.message : "Could not load ignore rules.",
      );
    } finally {
      setIgnoreRulesLoading(false);
    }
  };

  const ignoreRuleKey = (rule: VendorIgnoreRule) =>
    rule.ruleId ||
    `${rule.vendorKey}__${rule.parserFormatId}__${rule.documentType}`;

  const ignoreRuleStatusLabel = (status: VendorIgnoreRuleStatus) => {
    switch (status) {
      case "proposed":
        return "Proposed";
      case "active":
        return "Active";
      case "disabled":
        return "Disabled";
      case "archived":
        return "Archived";
      default:
        return status;
    }
  };

  const ignoreRuleStatusColor = (status: VendorIgnoreRuleStatus) => {
    switch (status) {
      case "proposed":
        return "var(--admin-warning-text)";
      case "active":
        return "var(--admin-success-text)";
      case "disabled":
        return "var(--admin-text-muted)";
      case "archived":
        return "var(--admin-text-muted)";
      default:
        return "var(--admin-text-muted)";
    }
  };

  const DOMAIN_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

  const ignoreRuleDomainFlag = (
    rule: VendorIgnoreRule,
  ): "ok" | "grace" | "expired" | null => {
    const status = rule.status ?? (rule.enabled ? "active" : "disabled");
    if (status !== "active") return null;
    if (rule.senderDomains && rule.senderDomains.length > 0) return "ok";
    if (!rule.domainGraceStartedAt) return "grace";
    const startMs = Date.parse(rule.domainGraceStartedAt);
    if (Number.isNaN(startMs)) return "grace";
    return Date.now() >= startMs + DOMAIN_GRACE_MS ? "expired" : "grace";
  };

  const parseActivateDomains = (raw: string): string[] => {
    const parts = raw
      .split(/[,;\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    const out: string[] = [];
    const seen = new Set<string>();
    for (const part of parts) {
      const lower = part.toLowerCase();
      const domain = lower.includes("@")
        ? lower.split("@").pop()?.trim()
        : lower;
      if (!domain || seen.has(domain)) continue;
      seen.add(domain);
      out.push(domain);
      if (out.length >= 5) break;
    }
    return out;
  };

  const patchIgnoreRule = (updated: VendorIgnoreRule) => {
    setIgnoreRules((prev) =>
      (prev ?? []).map((r) =>
        ignoreRuleKey(r) === ignoreRuleKey(updated) ? updated : r,
      ),
    );
  };

  const visibleIgnoreRules = (ignoreRules ?? []).filter((r) =>
    showArchivedIgnoreRules ? true : r.status !== "archived",
  );

  const loadIgnoreRuleAudit = async (rule: VendorIgnoreRule) => {
    const key = ignoreRuleKey(rule);
    if (!ignoreRulesPassword.trim()) return;
    if (ignoreRuleAuditKey === key && ignoreRuleAuditEvents) {
      setIgnoreRuleAuditKey(null);
      setIgnoreRuleAuditEvents(null);
      return;
    }
    setIgnoreRuleAuditLoading(true);
    setIgnoreRuleAuditKey(key);
    setIgnoreRuleAuditEvents(null);
    setIgnoreRulesError(null);
    try {
      const events = await listIgnoreRuleAuditEvents({
        password: ignoreRulesPassword,
        ruleId: rule.ruleId ?? key,
      });
      setIgnoreRuleAuditEvents(events);
    } catch (err) {
      setIgnoreRulesError(
        err instanceof Error ? err.message : "Could not load audit events.",
      );
      setIgnoreRuleAuditKey(null);
    } finally {
      setIgnoreRuleAuditLoading(false);
    }
  };

  const loadTrainingNoteAudit = async () => {
    if (
      !isIgnoreRulesManager &&
      ignoreRulesPassword.trim().length < 8
    ) {
      return;
    }
    setTrainingNoteAuditLoading(true);
    setTrainingNoteAuditError(null);
    try {
      const entries = await listTrainingNoteAudit({
        ...(isIgnoreRulesManager
          ? {}
          : { password: ignoreRulesPassword }),
        limit: 15,
      });
      setTrainingNoteAuditEntries(entries);
    } catch (err) {
      setTrainingNoteAuditError(
        err instanceof Error ? err.message : "Could not load note audit.",
      );
      setTrainingNoteAuditEntries(null);
    } finally {
      setTrainingNoteAuditLoading(false);
    }
  };

  const runLegacyMigration = async () => {
    if (!isIgnoreRulesManager || legacyMigrationBusy) return;
    setLegacyMigrationBusy(true);
    setLegacyMigrationMessage(null);
    setIgnoreRulesError(null);
    try {
      const result = await migrateLegacyVendorIgnoreRules();
      setLegacyMigrationMessage(
        `Migration: scanned ${result.scanned}, migrated ${result.migrated}, skipped ${result.skipped}, proposed ${result.proposedCount}.`,
      );
      if (ignoreRulesPassword.trim()) {
        await loadIgnoreRules();
      }
    } catch (err) {
      setIgnoreRulesError(
        err instanceof Error ? err.message : "Legacy migration failed.",
      );
    } finally {
      setLegacyMigrationBusy(false);
    }
  };

  const activateIgnoreRule = async (rule: VendorIgnoreRule) => {
    if (!isIgnoreRulesManager || ignoreRulesBusyKey) return;
    const key = ignoreRuleKey(rule);
    setIgnoreRulesBusyKey(key);
    setIgnoreRulesError(null);
    try {
      const draftDomains = activateDomainsDraft[key]?.trim() ?? "";
      const parsedDomains = draftDomains
        ? parseActivateDomains(draftDomains)
        : undefined;
      const needsDomains =
        !(rule.senderDomains && rule.senderDomains.length > 0) && !parsedDomains?.length;
      if (needsDomains) {
        setIgnoreRulesError(
          "Enter at least one sender domain (e.g. vendor.com) to activate.",
        );
        return;
      }
      const updated = await activateVendorIgnoreRule({
        ruleId: rule.ruleId,
        vendorKey: rule.vendorKey,
        parserFormatId: rule.parserFormatId,
        documentType: rule.documentType,
        ...(parsedDomains?.length ? { senderDomains: parsedDomains } : {}),
      });
      patchIgnoreRule(updated);
      setActivateDomainsDraft((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    } catch (err) {
      setIgnoreRulesError(
        err instanceof Error ? err.message : "Could not activate rule.",
      );
    } finally {
      setIgnoreRulesBusyKey(null);
    }
  };

  const disableIgnoreRule = async (rule: VendorIgnoreRule) => {
    if (!isIgnoreRulesManager || ignoreRulesBusyKey) return;
    const key = ignoreRuleKey(rule);
    setIgnoreRulesBusyKey(key);
    setIgnoreRulesError(null);
    try {
      const updated = await updateVendorIgnoreRule({
        ruleId: rule.ruleId,
        vendorKey: rule.vendorKey,
        parserFormatId: rule.parserFormatId,
        documentType: rule.documentType,
        enabled: false,
      });
      patchIgnoreRule(updated);
    } catch (err) {
      setIgnoreRulesError(
        err instanceof Error ? err.message : "Could not disable rule.",
      );
    } finally {
      setIgnoreRulesBusyKey(null);
    }
  };

  const bulkReopenSkippedByRule = async (rule: VendorIgnoreRule) => {
    if (!isIgnoreRulesManager || bulkReopenBusyKey || ignoreRulesBusyKey) return;
    const key = ignoreRuleKey(rule);
    const ruleId =
      rule.ruleId ??
      `${rule.vendorKey}__${rule.parserFormatId}__${rule.documentType}`;
    setBulkReopenBusyKey(key);
    setIgnoreRulesError(null);
    try {
      const result = await bulkReopenImportsSkippedByRule({ ruleId });
      if (ignoreRulesPassword.trim()) {
        await loadIgnoreRules();
      }
      if (result.reopened === 0) {
        setIgnoreRulesError(
          result.scanned === 0
            ? "No rejected auto-skipped imports found for this rule."
            : "No imports were reopened (they may already be pending).",
        );
      } else if (result.autoDisabled) {
        setIgnoreRulesError(
          `Re-opened ${result.reopened} import(s). Rule auto-disabled after ${result.reopenCount ?? 2} false-positive re-opens.`,
        );
      }
    } catch (err) {
      setIgnoreRulesError(
        err instanceof Error
          ? err.message
          : "Could not bulk re-open skipped imports.",
      );
    } finally {
      setBulkReopenBusyKey(null);
    }
  };

  const archiveIgnoreRule = async (rule: VendorIgnoreRule) => {
    if (ignoreRulesBusyKey) return;
    const key = ignoreRuleKey(rule);
    setIgnoreRulesBusyKey(key);
    setIgnoreRulesError(null);
    try {
      let updated: VendorIgnoreRule;
      if (isIgnoreRulesManager) {
        updated = await archiveVendorIgnoreRule({
          ruleId: rule.ruleId,
          vendorKey: rule.vendorKey,
          parserFormatId: rule.parserFormatId,
          documentType: rule.documentType,
        });
      } else if (ignoreRulesPassword.trim()) {
        updated = await archiveVendorIgnoreRule({
          password: ignoreRulesPassword,
          ruleId: rule.ruleId,
          vendorKey: rule.vendorKey,
          parserFormatId: rule.parserFormatId,
          documentType: rule.documentType,
        });
      } else {
        throw new Error("Manager role or admin password required to archive.");
      }
      patchIgnoreRule(updated);
      if (ignoreRuleAuditKey === key) {
        setIgnoreRuleAuditKey(null);
        setIgnoreRuleAuditEvents(null);
      }
    } catch (err) {
      setIgnoreRulesError(
        err instanceof Error ? err.message : "Could not archive rule.",
      );
    } finally {
      setIgnoreRulesBusyKey(null);
    }
  };

  const saveRevertWindow = async () => {
    if (savingRevert) return;
    const trimmedStart = stageVerifyActivatedAt.trim();
    if (trimmedStart && !/^\d{4}-\d{2}-\d{2}$/.test(trimmedStart)) {
      setStageVerifyStartDateError("Use a calendar date (YYYY-MM-DD).");
      return;
    }
    setStageVerifyStartDateError(null);
    setSavingRevert(true);
    try {
      const patch: Partial<AppSettings> = {
        vendorRevertWindowMinutes: revertWindowMinutes,
        vendorDeliveryMode,
        vendorSessionMinutes,
        technicianSessionMinutes,
        vendorGeofenceEnforce,
        // Empty clears via deleteField — omit would leave the prior value on merge.
        stageVerifyActivatedAt: trimmedStart ? trimmedStart : undefined,
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
    backgroundColor: "var(--admin-surface)",
    border: "1px solid var(--admin-border)",
    borderRadius: "var(--admin-radius-lg)",
    boxShadow: "var(--admin-shadow-card)",
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
    border: "1.5px solid var(--admin-border)",
    minHeight: "var(--admin-control-height)",
    borderRadius: "var(--admin-control-radius)",
    fontSize: 14,
    color: "var(--admin-text)",
    outline: "none",
    backgroundColor: "var(--admin-surface)",
    fontFamily: FONT,
    boxSizing: "border-box",
  };

  const labelStyle: CSSProperties = {
    display: "block",
    fontSize: 13,
    fontWeight: 700,
    color: "var(--admin-text-muted)",
    marginBottom: 6,
  };

  if (portalNavFocus(location.search) === "vendors") {
    return <Navigate to="/vendors" replace />;
  }

  return (
    <PortalShell style={{ fontFamily: FONT }}>
      <PortalSidebar />
      {/* Main content */}
      <div
        className={PORTAL_MAIN_CLASS}
        style={{ backgroundColor: "var(--admin-bg)" }}
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
          style={{ backgroundColor: "var(--admin-bg)" }}
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
                color: "var(--admin-accent-soft)",
                margin: 0,
                lineHeight: "1.2",
              }}
            >
              Settings
            </h1>
            <p style={{ fontSize: 13, color: "var(--admin-text-muted)", marginTop: 4 }}>
              Manage staging spots and workflow configuration.
            </p>
          </div>

          {/* Workflow settings */}
          <div style={{ ...cardStyle, overflow: "hidden" }}>
            <div
              style={{
                padding: "15px 20px",
                borderBottom: "1px solid var(--admin-border)",
              }}
            >
              <span style={{ fontWeight: 700, fontSize: 15, color: "var(--admin-accent-soft)" }}>
                Workflow
              </span>
            </div>
            <div
              style={{
                padding: "16px 20px 0",
                display: "flex",
                alignItems: "center",
                gap: 12,
                flexWrap: "wrap",
              }}
            >
              <label
                htmlFor="settings-stageverify-start-date"
                style={{
                  fontSize: 13,
                  fontWeight: 700,
                  color: "var(--admin-text-muted)",
                  whiteSpace: "nowrap",
                }}
              >
                StageVerify Start Date
              </label>
              <input
                id="settings-stageverify-start-date"
                data-testid="settings-stageverify-start-date"
                type="date"
                value={stageVerifyActivatedAt}
                onChange={(e) => {
                  setStageVerifyActivatedAt(e.target.value);
                  setStageVerifyStartDateError(null);
                }}
                onBlur={() => void saveRevertWindow()}
                style={{
                  padding: "10px 12px",
                  border: "1.5px solid var(--admin-border)",
                  borderRadius: 6,
                  fontSize: 14,
                  color: "var(--admin-text)",
                  outline: "none",
                  backgroundColor: "var(--admin-surface)",
                  fontFamily: FONT,
                  boxSizing: "border-box",
                }}
              />
              <span
                data-testid="settings-stageverify-start-date-hint"
                style={{ fontSize: 12, color: "var(--admin-text-muted)", maxWidth: 360 }}
              >
                Reporting baseline (“Since StageVerify started”). Does not change
                past events. Clear and save to remove.
              </span>
              {stageVerifyStartDateError && (
                <span
                  role="alert"
                  style={{ fontSize: 12, color: "var(--admin-danger-text)", width: "100%" }}
                >
                  {stageVerifyStartDateError}
                </span>
              )}
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
                  color: "var(--admin-text-muted)",
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
                  border: "1.5px solid var(--admin-border)",
                  borderRadius: 6,
                  fontSize: 14,
                  color: "var(--admin-text)",
                  outline: "none",
                  backgroundColor: "var(--admin-surface)",
                  fontFamily: FONT,
                  boxSizing: "border-box",
                }}
              />
              <span style={{ fontSize: 13, color: "var(--admin-text-muted)" }}>minutes</span>
              <label
                style={{
                  fontSize: 13,
                  fontWeight: 700,
                  color: "var(--admin-text-muted)",
                  whiteSpace: "nowrap",
                  marginLeft: 8,
                }}
              >
                PIN session length
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
                  border: "1.5px solid var(--admin-border)",
                  borderRadius: 6,
                  fontSize: 14,
                  color: "var(--admin-text)",
                  outline: "none",
                  backgroundColor: "var(--admin-surface)",
                  fontFamily: FONT,
                  boxSizing: "border-box",
                }}
              />
              <span style={{ fontSize: 13, color: "var(--admin-text-muted)" }}>
                min (absolute TTL)
              </span>
              <label
                style={{
                  fontSize: 13,
                  fontWeight: 700,
                  color: "var(--admin-text-muted)",
                  whiteSpace: "nowrap",
                  marginLeft: 8,
                }}
              >
                Technician PIN session length
              </label>
              <input
                type="number"
                min={5}
                max={480}
                value={technicianSessionMinutes}
                onChange={(e) =>
                  setTechnicianSessionMinutes(Number(e.target.value) || 15)
                }
                onBlur={() => void saveRevertWindow()}
                style={{
                  width: 80,
                  padding: "10px 12px",
                  border: "1.5px solid var(--admin-border)",
                  borderRadius: 6,
                  fontSize: 14,
                  color: "var(--admin-text)",
                  outline: "none",
                  backgroundColor: "var(--admin-surface)",
                  fontFamily: FONT,
                  boxSizing: "border-box",
                }}
              />
              <span style={{ fontSize: 13, color: "var(--admin-text-muted)" }}>
                min (absolute TTL)
              </span>
              <label
                style={{
                  fontSize: 13,
                  fontWeight: 700,
                  color: "var(--admin-text-muted)",
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
                  border: "1.5px solid var(--admin-border)",
                  borderRadius: 6,
                  fontSize: 14,
                  color: "var(--admin-text)",
                  backgroundColor: "var(--admin-surface)",
                  fontFamily: FONT,
                }}
              >
                <option value="full_checkin">Full check-in (legacy)</option>
                <option value="exception_only">Exception-only Delivered hub</option>
              </select>
              <button
                type="button"
                data-testid="settings-workflow-save"
                onClick={() => void saveRevertWindow()}
                disabled={savingRevert}
                style={{
                  padding: "8px 18px",
                  borderRadius: 4,
                  border: "none",
                  backgroundColor: savingRevert ? "var(--admin-surface-2)" : NAVY,
                  color: savingRevert ? "var(--admin-text-muted)" : "var(--admin-on-navy)",
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
                    color: "var(--admin-success-text)",
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
                  color: "var(--admin-text-muted)",
                  width: "100%",
                }}
              >
                Shop geofence (vendor receive warn)
              </span>
              <label style={{ fontSize: 13, color: "var(--admin-text-muted)" }}>Lat</label>
              <input
                type="text"
                value={shopLatitude}
                onChange={(e) => setShopLatitude(e.target.value)}
                onBlur={() => void saveRevertWindow()}
                placeholder="41.88"
                style={{
                  width: 100,
                  padding: "8px 10px",
                  border: "1.5px solid var(--admin-border)",
                  borderRadius: 6,
                  fontSize: 14,
                  fontFamily: FONT,
                }}
              />
              <label style={{ fontSize: 13, color: "var(--admin-text-muted)" }}>Lng</label>
              <input
                type="text"
                value={shopLongitude}
                onChange={(e) => setShopLongitude(e.target.value)}
                onBlur={() => void saveRevertWindow()}
                placeholder="-87.63"
                style={{
                  width: 100,
                  padding: "8px 10px",
                  border: "1.5px solid var(--admin-border)",
                  borderRadius: 6,
                  fontSize: 14,
                  fontFamily: FONT,
                }}
              />
              <label style={{ fontSize: 13, color: "var(--admin-text-muted)" }}>Radius (m)</label>
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
                  border: "1.5px solid var(--admin-border)",
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
                  color: "var(--admin-text-muted)",
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
                borderBottom: "1px solid var(--admin-border)",
              }}
            >
              <span style={{ fontWeight: 700, fontSize: 15, color: "var(--admin-accent-soft)" }}>
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
                      border: "1px solid var(--admin-border)",
                      backgroundColor: "var(--admin-surface-2)",
                      maxWidth: 560,
                      marginBottom: 16,
                    }}
                  >
                    <div
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        color: "var(--admin-accent-soft)",
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
                          color: "var(--admin-text)",
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
                            color: "var(--admin-text-muted)",
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
                            color: "var(--admin-text-muted)",
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
                            color: emailMonitoringEnabled ? "var(--admin-success-text)" : "var(--admin-text-muted)",
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
                        color: "var(--admin-text-muted)",
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
                                ? "var(--admin-border)"
                                : NAVY,
                            color:
                              connectingGmail || loadingGmailConnection
                                ? "var(--admin-text-muted)"
                                : "var(--admin-on-navy)",
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
                            border: "1px solid var(--admin-border)",
                            backgroundColor: disconnectingGmail ? "var(--admin-surface-2)" : "var(--admin-surface)",
                            color: disconnectingGmail ? "var(--admin-text-muted)" : "var(--admin-text)",
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
                          ? "var(--admin-danger-text)"
                          : "var(--admin-success-text)",
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
                      color: "var(--admin-text)",
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
                          color: "var(--admin-text-muted)",
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
                      color: "var(--admin-text)",
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
                          color: "var(--admin-text-muted)",
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
                      border: "1px solid var(--admin-border)",
                      borderRadius: 8,
                      backgroundColor: "var(--admin-surface-2)",
                      maxWidth: 560,
                    }}
                  >
                    <div
                      style={{
                        fontSize: 14,
                        fontWeight: 700,
                        color: "var(--admin-accent-soft)",
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
                      for editing vendor training playbooks and remembered ignore
                      rules. Dispatcher only. Password is stored as a hash — never
                      shown again.
                    </p>
                    <label
                      style={{
                        display: "block",
                        fontSize: 12,
                        fontWeight: 600,
                        color: "var(--admin-text)",
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
                        backgroundColor: "var(--admin-surface)",
                        marginBottom: 10,
                        fontFamily: FONT,
                      }}
                    />
                    <label
                      style={{
                        display: "block",
                        fontSize: 12,
                        fontWeight: 600,
                        color: "var(--admin-text)",
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
                        backgroundColor: "var(--admin-surface)",
                        marginBottom: 10,
                        fontFamily: FONT,
                      }}
                    />
                    <div
                      style={{
                        fontSize: 11,
                        color: invoiceTrainingPasswordConfigured
                          ? "var(--admin-success-text)"
                          : "var(--admin-warning-text)",
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
                            ? "var(--admin-surface-2)"
                            : NAVY,
                        color:
                          savingTrainingAdmin ||
                          !invoiceTrainingAlertEmail.trim() ||
                          invoiceTrainingAdminPassword.length < 8
                            ? "var(--admin-text-muted)"
                            : "var(--admin-on-navy)",
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
                    <div
                      data-testid="settings-invoice-ignore-rules"
                      style={{
                        marginTop: 18,
                        paddingTop: 14,
                        borderTop: "1px solid var(--admin-border)",
                      }}
                    >
                      <div
                        style={{
                          fontSize: 13,
                          fontWeight: 700,
                          color: "var(--admin-accent-soft)",
                          marginBottom: 6,
                        }}
                      >
                        Remembered ignore rules
                      </div>
                      <p
                        style={{
                          margin: "0 0 10px",
                          fontSize: 12,
                          color: "#4b5563",
                          lineHeight: 1.45,
                          fontWeight: 500,
                        }}
                      >
                        Teach-chat proposals queue here until a manager activates
                        them. Active rules skip future review-queue imports — never
                        delete deliveries or items. Managers activate, disable, or
                        archive (decline) rules.
                      </p>
                      {isIgnoreRulesManager ? (
                        <p
                          data-testid="invoice-ignore-rules-manager-hint"
                          style={{
                            margin: "0 0 10px",
                            fontSize: 12,
                            color: "var(--admin-success-text)",
                            fontWeight: 600,
                          }}
                        >
                          You have manager role — Activate / Disable / Archive
                          controls are enabled.
                        </p>
                      ) : (
                        <p
                          data-testid="invoice-ignore-rules-readonly-hint"
                          style={{
                            margin: "0 0 10px",
                            fontSize: 12,
                            color: "var(--admin-text-muted)",
                            fontWeight: 500,
                          }}
                        >
                          View-only unless you have manager role. Unlock with admin
                          password to list rules; archive (decline) still works with
                          password.
                        </p>
                      )}
                      <label
                        style={{
                          display: "block",
                          fontSize: 12,
                          fontWeight: 600,
                          color: "var(--admin-text)",
                          marginBottom: 4,
                        }}
                      >
                        Admin password to unlock rules
                      </label>
                      <div
                        style={{
                          display: "flex",
                          flexWrap: "wrap",
                          gap: 8,
                          alignItems: "center",
                          marginBottom: 10,
                        }}
                      >
                        <input
                          type="password"
                          data-testid="invoice-ignore-rules-password"
                          value={ignoreRulesPassword}
                          onChange={(e) =>
                            setIgnoreRulesPassword(e.target.value)
                          }
                          placeholder="Admin password"
                          autoComplete="current-password"
                          style={{
                            flex: "1 1 180px",
                            boxSizing: "border-box",
                            padding: "8px 10px",
                            border: "1px solid #cbd5e1",
                            borderRadius: 6,
                            fontSize: 13,
                            color: "#111827",
                            backgroundColor: "var(--admin-surface)",
                            fontFamily: FONT,
                          }}
                        />
                        <button
                          type="button"
                          data-testid="load-invoice-ignore-rules"
                          onClick={() => void loadIgnoreRules()}
                          disabled={
                            ignoreRulesLoading ||
                            ignoreRulesPassword.trim().length < 8
                          }
                          style={{
                            padding: "8px 14px",
                            borderRadius: 4,
                            border: "none",
                            backgroundColor:
                              ignoreRulesLoading ||
                              ignoreRulesPassword.trim().length < 8
                                ? "var(--admin-surface-2)"
                                : NAVY,
                            color:
                              ignoreRulesLoading ||
                              ignoreRulesPassword.trim().length < 8
                                ? "var(--admin-text-muted)"
                                : "var(--admin-on-navy)",
                            fontWeight: 700,
                            fontSize: 13,
                            cursor:
                              ignoreRulesLoading ||
                              ignoreRulesPassword.trim().length < 8
                                ? "not-allowed"
                                : "pointer",
                            fontFamily: FONT,
                          }}
                        >
                          {ignoreRulesLoading ? "Loading…" : "Unlock rules"}
                        </button>
                        {ignoreRules && (
                          <label
                            data-testid="invoice-ignore-rules-show-archived"
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 6,
                              fontSize: 12,
                              fontWeight: 600,
                              color: "var(--admin-text)",
                              cursor: "pointer",
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={showArchivedIgnoreRules}
                              onChange={(e) =>
                                setShowArchivedIgnoreRules(e.target.checked)
                              }
                            />
                            Show archived
                          </label>
                        )}
                        {isIgnoreRulesManager && ignoreRules && (
                          <button
                            type="button"
                            data-testid="migrate-legacy-ignore-rules"
                            disabled={legacyMigrationBusy}
                            onClick={() => void runLegacyMigration()}
                            style={{
                              padding: "8px 12px",
                              borderRadius: 4,
                              border: `1px solid ${NAVY}`,
                              backgroundColor: "var(--admin-surface)",
                              color: "var(--admin-accent-soft)",
                              fontWeight: 700,
                              fontSize: 12,
                              cursor: legacyMigrationBusy
                                ? "not-allowed"
                                : "pointer",
                              fontFamily: FONT,
                            }}
                          >
                            {legacyMigrationBusy
                              ? "Migrating…"
                              : "Migrate legacy rules"}
                          </button>
                        )}
                      </div>
                      {legacyMigrationMessage && (
                        <p
                          data-testid="legacy-ignore-migration-result"
                          style={{
                            margin: "0 0 10px",
                            fontSize: 12,
                            color: "var(--admin-success-text)",
                            fontWeight: 600,
                          }}
                        >
                          {legacyMigrationMessage}
                        </p>
                      )}
                      {ignoreRulesError && (
                        <p
                          data-testid="invoice-ignore-rules-error"
                          style={{
                            margin: "0 0 8px",
                            fontSize: 12,
                            color: RED,
                            fontWeight: 600,
                          }}
                        >
                          {ignoreRulesError}
                        </p>
                      )}
                      {ignoreRules && ignoreRules.length === 0 && (
                        <p
                          data-testid="invoice-ignore-rules-empty"
                          style={{
                            margin: 0,
                            fontSize: 12,
                            color: "var(--admin-text-muted)",
                            fontWeight: 500,
                          }}
                        >
                          No ignore rules yet. Teach one from a CREDIT/return in
                          Parsed import — it will appear as Proposed until a manager
                          activates it.
                        </p>
                      )}
                      {ignoreRules &&
                        ignoreRules.some((r) => r.status === "proposed") && (
                          <div
                            data-testid="invoice-ignore-rules-proposal-queue"
                            style={{ marginBottom: 12 }}
                          >
                            <div
                              style={{
                                fontSize: 12,
                                fontWeight: 700,
                                color: "var(--admin-warning-text)",
                                marginBottom: 6,
                              }}
                            >
                              Proposal queue (
                              {
                                ignoreRules.filter((r) => r.status === "proposed")
                                  .length
                              }
                              )
                            </div>
                          </div>
                        )}
                      {ignoreRules && visibleIgnoreRules.length > 0 && (
                        <ul
                          data-testid="invoice-ignore-rules-list"
                          style={{
                            listStyle: "none",
                            margin: 0,
                            padding: 0,
                            display: "flex",
                            flexDirection: "column",
                            gap: 8,
                          }}
                        >
                          {visibleIgnoreRules.map((rule) => {
                            const key = ignoreRuleKey(rule);
                            const status =
                              rule.status ??
                              (rule.enabled ? "active" : "disabled");
                            return (
                            <li
                              key={key}
                              data-testid={`invoice-ignore-rule-${key}`}
                              style={{
                                padding: "10px 12px",
                                backgroundColor: "var(--admin-surface)",
                                border: "1px solid var(--admin-border)",
                                borderRadius: 6,
                                display: "flex",
                                flexWrap: "wrap",
                                gap: 8,
                                alignItems: "center",
                                justifyContent: "space-between",
                              }}
                            >
                              <div style={{ minWidth: 0, flex: "1 1 160px" }}>
                                <div
                                  style={{
                                    fontSize: 13,
                                    fontWeight: 700,
                                    color: "#111827",
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 8,
                                    flexWrap: "wrap",
                                  }}
                                >
                                  <span>{rule.vendorKey}</span>
                                  <span
                                    data-testid={`ignore-rule-status-${key}`}
                                    style={{
                                      fontSize: 10,
                                      fontWeight: 700,
                                      textTransform: "uppercase",
                                      letterSpacing: "0.04em",
                                      padding: "2px 6px",
                                      borderRadius: 4,
                                      backgroundColor: `${ignoreRuleStatusColor(status)}18`,
                                      color: ignoreRuleStatusColor(status),
                                    }}
                                  >
                                    {ignoreRuleStatusLabel(status)}
                                  </span>
                                </div>
                                <div
                                  style={{
                                    fontSize: 11,
                                    color: "var(--admin-text-muted)",
                                    fontWeight: 500,
                                    marginTop: 2,
                                  }}
                                >
                                  {rule.label ||
                                    `${rule.documentType} · ${rule.parserFormatId}`}
                                  {rule.senderDomains &&
                                  rule.senderDomains.length > 0 ? (
                                    <span
                                      data-testid={`ignore-rule-domains-${key}`}
                                    >
                                      {" "}
                                      · domains: {rule.senderDomains.join(", ")}
                                    </span>
                                  ) : null}
                                  {rule.updatedAt
                                    ? ` · updated ${rule.updatedAt.slice(0, 10)}`
                                    : ""}
                                  {typeof rule.matchCount === "number" &&
                                  rule.matchCount > 0 ? (
                                    <span
                                      data-testid={`ignore-rule-match-count-${key}`}
                                    >
                                      {" "}
                                      · matches: {rule.matchCount}
                                      {rule.lastMatchedAt
                                        ? ` (last ${rule.lastMatchedAt.slice(0, 10)})`
                                        : ""}
                                    </span>
                                  ) : null}
                                  {typeof rule.reopenCount === "number" &&
                                  rule.reopenCount > 0 ? (
                                    <span
                                      data-testid={`ignore-rule-reopen-count-${key}`}
                                    >
                                      {" "}
                                      · re-opens: {rule.reopenCount}
                                    </span>
                                  ) : null}
                                  {rule.disabledReason === "auto_false_positive" ? (
                                    <span
                                      data-testid={`ignore-rule-auto-disabled-${key}`}
                                      style={{ color: RED }}
                                    >
                                      {" "}
                                      · auto-disabled (false positive)
                                    </span>
                                  ) : null}
                                </div>
                                {ignoreRuleDomainFlag(rule) === "grace" && (
                                  <div
                                    data-testid={`ignore-rule-domain-grace-${key}`}
                                    style={{
                                      fontSize: 11,
                                      color: "var(--admin-warning-text)",
                                      fontWeight: 600,
                                      marginTop: 4,
                                    }}
                                  >
                                    Needs sender domains — 7-day grace active
                                  </div>
                                )}
                                {ignoreRuleDomainFlag(rule) === "expired" && (
                                  <div
                                    data-testid={`ignore-rule-domain-expired-${key}`}
                                    style={{
                                      fontSize: 11,
                                      color: RED,
                                      fontWeight: 600,
                                      marginTop: 4,
                                    }}
                                  >
                                    Grace expired — add sender domains to match
                                    inbound mail
                                  </div>
                                )}
                              </div>
                              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                                {(status === "proposed" ||
                                  status === "disabled") &&
                                  isIgnoreRulesManager && (
                                  <>
                                    {!(rule.senderDomains && rule.senderDomains.length > 0) && (
                                      <input
                                        type="text"
                                        data-testid={`activate-ignore-domains-${key}`}
                                        placeholder="vendor.com"
                                        value={activateDomainsDraft[key] ?? ""}
                                        onChange={(e) =>
                                          setActivateDomainsDraft((prev) => ({
                                            ...prev,
                                            [key]: e.target.value,
                                          }))
                                        }
                                        style={{
                                          padding: "6px 8px",
                                          borderRadius: 4,
                                          border: "1px solid var(--admin-border)",
                                          fontSize: 12,
                                          minWidth: 120,
                                          color: "#111827",
                                          backgroundColor: "var(--admin-surface)",
                                          fontFamily: FONT,
                                        }}
                                      />
                                    )}
                                  <button
                                    type="button"
                                    data-testid={`activate-ignore-rule-${key}`}
                                    disabled={ignoreRulesBusyKey === key}
                                    onClick={() => void activateIgnoreRule(rule)}
                                    style={{
                                      padding: "6px 10px",
                                      borderRadius: 4,
                                      border: "none",
                                      backgroundColor: "var(--admin-success-text)",
                                      color: "var(--admin-text)",
                                      fontWeight: 700,
                                      fontSize: 12,
                                      cursor:
                                        ignoreRulesBusyKey === key
                                          ? "not-allowed"
                                          : "pointer",
                                      fontFamily: FONT,
                                    }}
                                  >
                                    Activate
                                  </button>
                                  </>
                                )}
                                {status === "active" && isIgnoreRulesManager && (
                                  <button
                                    type="button"
                                    data-testid={`disable-ignore-rule-${key}`}
                                    disabled={ignoreRulesBusyKey === key}
                                    onClick={() => void disableIgnoreRule(rule)}
                                    style={{
                                      padding: "6px 10px",
                                      borderRadius: 4,
                                      border: `1px solid ${NAVY}`,
                                      backgroundColor: "var(--admin-surface)",
                                      color: "var(--admin-accent-soft)",
                                      fontWeight: 700,
                                      fontSize: 12,
                                      cursor:
                                        ignoreRulesBusyKey === key
                                          ? "not-allowed"
                                          : "pointer",
                                      fontFamily: FONT,
                                    }}
                                  >
                                    Disable
                                  </button>
                                )}
                                {(status === "active" || status === "disabled") &&
                                  isIgnoreRulesManager && (
                                  <button
                                    type="button"
                                    data-testid={`bulk-reopen-ignore-rule-${key}`}
                                    disabled={
                                      bulkReopenBusyKey === key ||
                                      ignoreRulesBusyKey === key
                                    }
                                    onClick={() =>
                                      void bulkReopenSkippedByRule(rule)
                                    }
                                    style={{
                                      padding: "6px 10px",
                                      borderRadius: 4,
                                      border: `1px solid ${RED}`,
                                      backgroundColor: "var(--admin-surface)",
                                      color: RED,
                                      fontWeight: 700,
                                      fontSize: 12,
                                      cursor:
                                        bulkReopenBusyKey === key ||
                                        ignoreRulesBusyKey === key
                                          ? "not-allowed"
                                          : "pointer",
                                      fontFamily: FONT,
                                    }}
                                  >
                                    {bulkReopenBusyKey === key
                                      ? "Re-opening…"
                                      : "Re-open skipped"}
                                  </button>
                                )}
                                {!isIgnoreRulesManager &&
                                  (status === "proposed" ||
                                    status === "active") && (
                                  <span
                                    data-testid={`toggle-ignore-rule-${key}`}
                                    style={{
                                      fontSize: 11,
                                      color: "var(--admin-text-muted)",
                                      fontWeight: 600,
                                      padding: "6px 4px",
                                    }}
                                  >
                                    Manager required to change
                                  </span>
                                )}
                                <button
                                  type="button"
                                  data-testid={`audit-ignore-rule-${key}`}
                                  disabled={
                                    ignoreRuleAuditLoading ||
                                    ignoreRulesPassword.trim().length < 8
                                  }
                                  onClick={() => void loadIgnoreRuleAudit(rule)}
                                  style={{
                                    padding: "6px 10px",
                                    borderRadius: 4,
                                    border: "1px solid var(--admin-border)",
                                    backgroundColor: "var(--admin-surface)",
                                    color: "var(--admin-text)",
                                    fontWeight: 700,
                                    fontSize: 12,
                                    cursor:
                                      ignoreRuleAuditLoading ||
                                      ignoreRulesPassword.trim().length < 8
                                        ? "not-allowed"
                                        : "pointer",
                                    fontFamily: FONT,
                                  }}
                                >
                                  {ignoreRuleAuditKey === key
                                    ? "Hide audit"
                                    : "Audit"}
                                </button>
                                <button
                                  type="button"
                                  data-testid={`archive-ignore-rule-${key}`}
                                  disabled={
                                    ignoreRulesBusyKey === key ||
                                    (!isIgnoreRulesManager &&
                                      ignoreRulesPassword.trim().length < 8)
                                  }
                                  onClick={() => void archiveIgnoreRule(rule)}
                                  style={{
                                    padding: "6px 10px",
                                    borderRadius: 4,
                                    border: `1px solid ${RED}`,
                                    backgroundColor: "var(--admin-surface)",
                                    color: RED,
                                    fontWeight: 700,
                                    fontSize: 12,
                                    cursor:
                                      ignoreRulesBusyKey === key
                                        ? "not-allowed"
                                        : "pointer",
                                    fontFamily: FONT,
                                  }}
                                >
                                  Archive
                                </button>
                              </div>
                              {ignoreRuleAuditKey === key && (
                                <div
                                  data-testid={`ignore-rule-audit-panel-${key}`}
                                  style={{
                                    width: "100%",
                                    marginTop: 8,
                                    padding: "8px 10px",
                                    backgroundColor: "var(--admin-surface-2)",
                                    borderRadius: 6,
                                    border: "1px solid var(--admin-border)",
                                  }}
                                >
                                  {ignoreRuleAuditLoading ? (
                                    <span
                                      style={{
                                        fontSize: 12,
                                        color: "var(--admin-text-muted)",
                                        fontWeight: 600,
                                      }}
                                    >
                                      Loading audit…
                                    </span>
                                  ) : ignoreRuleAuditEvents &&
                                    ignoreRuleAuditEvents.length === 0 ? (
                                    <span
                                      style={{
                                        fontSize: 12,
                                        color: "var(--admin-text-muted)",
                                        fontWeight: 600,
                                      }}
                                    >
                                      No audit events yet.
                                    </span>
                                  ) : (
                                    <ul
                                      style={{
                                        listStyle: "none",
                                        margin: 0,
                                        padding: 0,
                                        display: "flex",
                                        flexDirection: "column",
                                        gap: 4,
                                      }}
                                    >
                                      {(ignoreRuleAuditEvents ?? []).map(
                                        (ev) => (
                                          <li
                                            key={ev.id}
                                            data-testid={`ignore-rule-audit-${ev.id}`}
                                            style={{
                                              fontSize: 11,
                                              color: "var(--admin-text)",
                                              fontWeight: 500,
                                            }}
                                          >
                                            <strong>{ev.eventType}</strong>
                                            {" · "}
                                            {ev.atIso.slice(0, 19)}
                                            {" · "}
                                            {ev.actorUid}
                                            {ev.detail ? ` — ${ev.detail}` : ""}
                                          </li>
                                        ),
                                      )}
                                    </ul>
                                  )}
                                </div>
                              )}
                            </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>
                    <div
                      data-testid="settings-training-note-audit"
                      style={{
                        marginTop: 18,
                        paddingTop: 14,
                        borderTop: "1px solid var(--admin-border)",
                      }}
                    >
                      <div
                        style={{
                          fontSize: 13,
                          fontWeight: 700,
                          color: "var(--admin-accent-soft)",
                          marginBottom: 6,
                        }}
                      >
                        Recent training notes (90-day audit)
                      </div>
                      <p
                        style={{
                          margin: "0 0 10px",
                          fontSize: 12,
                          color: "#4b5563",
                          lineHeight: 1.45,
                          fontWeight: 500,
                        }}
                      >
                        Redacted notes stored with lessons and ignore proposals.
                        Raw text visible to managers and Admin password holders
                        only.
                      </p>
                      <button
                        type="button"
                        data-testid="load-training-note-audit"
                        disabled={
                          trainingNoteAuditLoading ||
                          (!isIgnoreRulesManager &&
                            ignoreRulesPassword.trim().length < 8)
                        }
                        onClick={() => void loadTrainingNoteAudit()}
                        style={{
                          padding: "6px 12px",
                          borderRadius: 4,
                          border: "1px solid var(--admin-border)",
                          backgroundColor: "var(--admin-surface)",
                          color: "var(--admin-text)",
                          fontWeight: 700,
                          fontSize: 12,
                          cursor:
                            trainingNoteAuditLoading ||
                            (!isIgnoreRulesManager &&
                              ignoreRulesPassword.trim().length < 8)
                              ? "not-allowed"
                              : "pointer",
                          fontFamily: FONT,
                          marginBottom: 10,
                        }}
                      >
                        {trainingNoteAuditLoading
                          ? "Loading…"
                          : "Load recent notes"}
                      </button>
                      {trainingNoteAuditError && (
                        <p
                          data-testid="training-note-audit-error"
                          style={{
                            margin: "0 0 8px",
                            fontSize: 12,
                            color: RED,
                            fontWeight: 600,
                          }}
                        >
                          {trainingNoteAuditError}
                        </p>
                      )}
                      {trainingNoteAuditEntries &&
                        trainingNoteAuditEntries.length === 0 && (
                          <p
                            style={{
                              fontSize: 12,
                              color: "var(--admin-text-muted)",
                              fontWeight: 600,
                            }}
                          >
                            No training notes recorded yet.
                          </p>
                        )}
                      {trainingNoteAuditEntries &&
                        trainingNoteAuditEntries.length > 0 && (
                          <ul
                            style={{
                              listStyle: "none",
                              margin: 0,
                              padding: 0,
                              display: "flex",
                              flexDirection: "column",
                              gap: 8,
                            }}
                          >
                            {trainingNoteAuditEntries.map((entry) => (
                              <li
                                key={entry.id}
                                data-testid={`training-note-audit-${entry.id}`}
                                style={{
                                  padding: "8px 10px",
                                  backgroundColor: "var(--admin-surface)",
                                  border: "1px solid var(--admin-border)",
                                  borderRadius: 6,
                                  fontSize: 11,
                                  color: "var(--admin-text)",
                                }}
                              >
                                <div style={{ fontWeight: 700, marginBottom: 4 }}>
                                  {entry.lane} · {entry.vendorKey} ·{" "}
                                  {entry.createdAt.slice(0, 19)}
                                </div>
                                <div
                                  data-testid={`training-note-audit-redacted-${entry.id}`}
                                  style={{ fontWeight: 600 }}
                                >
                                  {entry.noteRedacted}
                                </div>
                                {entry.noteRaw && (
                                  <div
                                    data-testid={`training-note-audit-raw-${entry.id}`}
                                    style={{
                                      marginTop: 4,
                                      color: "var(--admin-text-muted)",
                                      fontStyle: "italic",
                                    }}
                                  >
                                    Raw: {entry.noteRaw}
                                  </div>
                                )}
                              </li>
                            ))}
                          </ul>
                        )}
                    </div>
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
                        backgroundColor: savingEmail ? "var(--admin-surface-2)" : NAVY,
                        color: savingEmail ? "var(--admin-text-muted)" : "var(--admin-on-navy)",
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
                          color: "var(--admin-success-text)",
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
                      color: "var(--admin-text-muted)",
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
                      border: "1px solid var(--admin-border)",
                      backgroundColor: "var(--admin-surface-2)",
                      maxWidth: 560,
                    }}
                  >
                    <div style={{ flex: "1 1 180px" }}>
                      <div
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          color: "var(--admin-accent-soft)",
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
                            connectingGmail || loadingGmailConnection ? "var(--admin-border)" : NAVY,
                          color:
                            connectingGmail || loadingGmailConnection ? "var(--admin-text-muted)" : "var(--admin-text)",
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
                        color: gmailOAuthMessage.includes("failed") ? "var(--admin-danger-text)" : "var(--admin-success-text)",
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
                        color: "var(--admin-text)",
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
                        backgroundColor: savingEmail ? "var(--admin-surface-2)" : NAVY,
                        color: savingEmail ? "var(--admin-text-muted)" : "var(--admin-on-navy)",
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
                          color: "var(--admin-success-text)",
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

          <PinAccessManagementPanel />

          <OfficeReceiversSettingsPanel />

          {isIgnoreRulesManager && (
            <div
              style={{ ...cardStyle, overflow: "hidden", marginTop: 16 }}
              data-testid="dispatcher-users-settings-section"
            >
              <DispatcherUsersSettingsPanel />
            </div>
          )}

          <div className="admin-card" style={{ ...cardStyle, overflow: "hidden", marginTop: 16, padding: 0 }}>
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
                borderBottom: "1px solid var(--admin-border)",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                flexWrap: "wrap",
              }}
            >
              <div>
                <span style={{ fontWeight: 700, fontSize: 15, color: "var(--admin-accent-soft)" }}>
                  Staging Spots
                </span>
                {!loadingSpots && (
                  <span
                    style={{
                      marginLeft: 8,
                      fontSize: 12,
                      color: "var(--admin-text-muted)",
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
                  color: "var(--admin-accent-soft)",
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
                  color: "var(--admin-text-muted)",
                  lineHeight: 1.45,
                  maxWidth: 560,
                }}
              >
                Spots on the Staging Map appear here — add or remove spots on{" "}
                <Link to="/zones" style={{ color: "var(--admin-accent-soft)", fontWeight: 600 }}>
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
                  color: "var(--admin-text)",
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                }}
              >
                On Staging Map
              </p>

              {loadingSpots ? (
                <p style={{ fontSize: 13, color: "var(--admin-text-muted)", margin: "0 0 16px" }}>
                  Loading spots…
                </p>
              ) : stagingSpots.length === 0 ? (
                <p
                  style={{
                    fontSize: 13,
                    color: "var(--admin-text-muted)",
                    margin: "0 0 16px",
                    padding: "12px 14px",
                    backgroundColor: "var(--admin-surface-2)",
                    border: "1px solid var(--admin-border)",
                    borderRadius: 6,
                  }}
                >
                  No staging spots on the map yet. Open{" "}
                  <Link to="/zones" style={{ color: "var(--admin-accent-soft)", fontWeight: 600 }}>
                    Staging Map
                  </Link>{" "}
                  → Edit Locations to add ground or shelf spots.
                </p>
              ) : (
                <div
                  style={{
                    overflowX: "auto",
                    marginBottom: 12,
                    border: "1px solid var(--admin-border)",
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
                      <tr style={{ backgroundColor: NAVY }} data-testid="settings-staging-table-header">
                        {["Code", "Label", "Type", "Status", "Sort", ""].map(
                          (col, i) => (
                            <th
                              key={i}
                              style={{
                                padding: "12px",
                                fontWeight: 700,
                                fontSize: 14,
                                color: "var(--admin-on-navy)",
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
                        const rowBg = idx % 2 === 0 ? "var(--admin-row-even)" : "var(--admin-row-odd)";
                        const tdBase: CSSProperties = {
                          padding: "10px 12px",
                          borderBottom: "1px solid var(--admin-border)",
                          verticalAlign: "middle",
                        };
                        const inlineInput: CSSProperties = {
                          padding: "4px 8px",
                          border: "1.5px solid var(--admin-border)",
                          borderRadius: 4,
                          fontSize: 13,
                          color: "var(--admin-text)",
                          fontFamily: FONT,
                          outline: "none",
                          width: "100%",
                          boxSizing: "border-box",
                          backgroundColor: "var(--admin-surface)",
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
                                color: "var(--admin-accent-soft)",
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
                              style={{ ...tdBase, color: "var(--admin-text)" }}
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
                            <td style={{ ...tdBase, color: "var(--admin-text)" }}>
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
                            <td style={{ ...tdBase, color: "var(--admin-text)" }}>
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
                                        ? "var(--admin-success-text)"
                                        : "var(--admin-text-muted)",
                                    fontWeight: 600,
                                  }}
                                >
                                  {spot.status}
                                </span>
                              )}
                            </td>
                            <td style={{ ...tdBase, color: "var(--admin-text)" }}>
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
                                        ? "var(--admin-border)"
                                        : NAVY,
                                      color: saveDisabled ? "var(--admin-text-muted)" : "var(--admin-on-navy)",
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
                                      border: "1.5px solid var(--admin-border)",
                                      backgroundColor: "var(--admin-surface)",
                                      color: "var(--admin-text-muted)",
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
                                    border: "1.5px solid #0a3161",
                                    backgroundColor: "var(--admin-surface)",
                                    color: "#0a3161",
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
    </PortalShell>
  );
}
