import {
  Fragment,
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import type {
  AccessPinTargetType,
  DispatcherAccountSummary,
  ManagementPinPermissions,
  ManagementPinPublic,
  Technician,
  TechnicianPermissions,
  Vendor,
} from "./dispatcher/models";
import {
  createTechnician,
  listTechnicians,
  listVendors,
  updateTechnician,
  updateVendor,
} from "./dispatcher/firestoreService";
import {
  deactivateManagementPinClient,
  deactivateDispatcherClient,
  listDispatchersClient,
  listManagementPinsClient,
  provisionDispatcherClient,
  revealAccessPinClient,
  revokeAdminAccessSessionClient,
  setAccessPinClient,
  startAdminAccessSessionClient,
  upsertManagementPinClient,
} from "./phase2CallableClients";
import {
  technicianCanReceiveReleases,
  technicianCanUseDoor,
} from "./dispatcher/technicianReleaseHelpers";
import {
  defaultBadgeColorHex,
  resolveTechnicianBadgeStyle,
  SWATCH_OPTIONS,
  TECHNICIAN_BADGE_PALETTE,
} from "./dispatcher/technicianBadgeColors";

const NAVY = "#0a3161";
const TEXT = "var(--admin-text)";
const MUTED = "var(--admin-text-muted)";
const FONT = '"Helvetica Neue", Helvetica, Arial, sans-serif';

const inputStyle: CSSProperties = {
  padding: "8px 10px",
  borderRadius: 6,
  border: "1px solid var(--admin-border)",
  fontSize: 14,
  color: TEXT,
  backgroundColor: "var(--admin-surface)",
  fontFamily: FONT,
  boxSizing: "border-box",
};

const primaryButtonStyle: CSSProperties = {
  padding: "8px 14px",
  borderRadius: 6,
  border: "none",
  backgroundColor: NAVY,
  color: "var(--admin-on-navy)",
  fontSize: 13,
  fontWeight: 700,
  cursor: "pointer",
  fontFamily: FONT,
};

const secondaryButtonStyle: CSSProperties = {
  padding: "7px 12px",
  borderRadius: 6,
  border: "1px solid var(--admin-border)",
  backgroundColor: "var(--admin-surface)",
  color: "var(--admin-accent-soft)",
  fontSize: 12,
  fontWeight: 700,
  cursor: "pointer",
  fontFamily: FONT,
};

const CAP_LABELS: Array<{
  key: keyof Required<ManagementPinPermissions>;
  label: string;
}> = [
  { key: "enterPortalAnyQr", label: "Enter portal from any location QR" },
  { key: "catchAllCheckIn", label: "Catch-all / CA check-in" },
  { key: "viewWaitingParts", label: "View jobs awaiting parts" },
  { key: "markOrFlagParcel", label: "Mark received / flag unidentifiable" },
];

const defaultTechnicianPermissions = (): TechnicianPermissions => ({
  doorScan: true,
  receiveReleases: true,
});

const defaultManagementPermissions =
  (): Required<ManagementPinPermissions> => ({
    enterPortalAnyQr: true,
    catchAllCheckIn: true,
    viewWaitingParts: true,
    markOrFlagParcel: true,
  });

function normalizeTechnicianPermissions(
  permissions?: TechnicianPermissions,
): TechnicianPermissions {
  return {
    doorScan: permissions?.doorScan !== false,
    receiveReleases: permissions?.receiveReleases !== false,
  };
}

function normalizeManagementPermissions(
  permissions?: ManagementPinPermissions,
): Required<ManagementPinPermissions> {
  return {
    enterPortalAnyQr: permissions?.enterPortalAnyQr !== false,
    catchAllCheckIn: permissions?.catchAllCheckIn !== false,
    viewWaitingParts: permissions?.viewWaitingParts !== false,
    markOrFlagParcel: permissions?.markOrFlagParcel !== false,
  };
}

function withoutPlaintextVendorPin(vendor: Vendor): Vendor {
  const copy = { ...vendor };
  delete copy.pinCode;
  return copy;
}

function withoutPlaintextTechnicianPin(technician: Technician): Technician {
  const copy = { ...technician };
  delete copy.pinCode;
  return copy;
}

function entityHasConfiguredPin(entity: Technician | Vendor): boolean {
  return Boolean(
    entity.pinCode ||
      entity.pinHash ||
      (entity as (Technician | Vendor) & { pinConfigured?: boolean })
        .pinConfigured,
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRevealUnavailableError(error: unknown): boolean {
  const message = errorMessage(error).toLowerCase();
  return (
    message.includes("cannot be revealed") ||
    message.includes("not revealable") ||
    message.includes("not configured")
  );
}

function isSessionValidityError(error: unknown): boolean {
  const message = errorMessage(error).toLowerCase();
  return (
    message.includes("session") &&
    (message.includes("invalid") ||
      message.includes("expired") ||
      message.includes("required"))
  );
}

type UserType =
  | "manager"
  | "dispatcher"
  | "technician"
  | "vendor"
  | "management";
type AuthUserType = Extract<UserType, "manager" | "dispatcher">;
type PinUserType = Exclude<UserType, AuthUserType>;

type SelectedAccess =
  | { type: AuthUserType; id: string }
  | { type: "technician"; id: string }
  | { type: "vendor"; id: string }
  | { type: "management"; id: string };

type PinEditorDraft =
  | {
      type: "technician";
      permissions: TechnicianPermissions;
      badgeColor: string;
      active: boolean;
    }
  | {
      type: "vendor";
      companyWideSessionEnabled: boolean;
      active: boolean;
    }
  | {
      type: "management";
      label: string;
      permissions: Required<ManagementPinPermissions>;
      active: boolean;
    };

type AdminAccessElevation = {
  token: string;
  targetType: AccessPinTargetType;
  targetId: string;
  expiresAt: string;
  revealedPin?: string;
  revealUnavailable?: boolean;
  pinHidden?: boolean;
};

type AccessRow =
  | {
      type: AuthUserType;
      id: string;
      name: string;
      active: boolean;
      accessMethod: "Email / Firebase Auth";
    }
  | {
      type: PinUserType;
      id: string;
      name: string;
      active: boolean;
      accessMethod: "PIN";
      hasPin: boolean;
    };

const typeLabels: Record<UserType, string> = {
  manager: "Manager",
  dispatcher: "Dispatcher",
  technician: "Technician",
  vendor: "Vendor",
  management: "Management",
};

function TypeChip({ type }: { type: UserType }) {
  const colors: Record<UserType, { bg: string; color: string }> = {
    manager: {
      bg: "var(--admin-success-bg)",
      color: "var(--admin-success-text)",
    },
    dispatcher: {
      bg: "var(--admin-info-bg)",
      color: "var(--admin-info-text)",
    },
    technician: { bg: "var(--admin-info-bg)", color: "var(--admin-info-text)" },
    vendor: { bg: "var(--admin-warning-bg)", color: "var(--admin-warning-text)" },
    management: { bg: "var(--admin-surface-2)", color: "var(--admin-text-label)" },
  };
  return (
    <span
      data-testid={`pin-access-type-${type}`}
      style={{
        display: "inline-flex",
        padding: "3px 9px",
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 700,
        ...colors[type],
      }}
    >
      {typeLabels[type]}
    </span>
  );
}

export function PinAccessManagementPanel({
  canManageDispatchers,
}: {
  canManageDispatchers: boolean;
}) {
  const [dispatchers, setDispatchers] = useState<DispatcherAccountSummary[]>([]);
  const [technicians, setTechnicians] = useState<Technician[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [managementPins, setManagementPins] = useState<ManagementPinPublic[]>([]);
  const [loading, setLoading] = useState(true);
  const [authLoading, setAuthLoading] = useState(false);
  const [selected, setSelected] = useState<SelectedAccess | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [authLoadError, setAuthLoadError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [lastTempPassword, setLastTempPassword] = useState<string | null>(null);
  const [pinDraft, setPinDraft] = useState("");
  const [editorDraft, setEditorDraft] = useState<PinEditorDraft | null>(null);
  const [adminAccess, setAdminAccess] =
    useState<AdminAccessElevation | null>(null);
  const adminAccessRef = useRef<AdminAccessElevation | null>(null);
  const adminAccessRequestRef = useRef(0);
  const revealHideTimerRef = useRef<number | null>(null);
  const mountedRef = useRef(true);
  const [adminAccessBusy, setAdminAccessBusy] = useState(false);

  const clearRevealHideTimer = useCallback(() => {
    if (revealHideTimerRef.current !== null) {
      window.clearTimeout(revealHideTimerRef.current);
      revealHideTimerRef.current = null;
    }
  }, []);

  const hideRevealedPin = useCallback(() => {
    const current = adminAccessRef.current;
    if (!current) return;
    const hiddenElevation: AdminAccessElevation = {
      token: current.token,
      targetType: current.targetType,
      targetId: current.targetId,
      expiresAt: current.expiresAt,
      pinHidden: true,
    };
    adminAccessRef.current = hiddenElevation;
    setAdminAccess(hiddenElevation);
  }, []);

  const scheduleRevealHide = useCallback(
    (revealedForMs: number) => {
      clearRevealHideTimer();
      revealHideTimerRef.current = window.setTimeout(() => {
        revealHideTimerRef.current = null;
        hideRevealedPin();
      }, revealedForMs);
    },
    [clearRevealHideTimer, hideRevealedPin],
  );

  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardStep, setWizardStep] = useState(1);
  const [wizardType, setWizardType] = useState<UserType>("technician");
  const [wizardName, setWizardName] = useState("");
  const [wizardVendorId, setWizardVendorId] = useState("");
  const [wizardPin, setWizardPin] = useState("");
  const [wizardEmail, setWizardEmail] = useState("");
  const [wizardTemporaryPassword, setWizardTemporaryPassword] = useState("");
  const [wizardTechPermissions, setWizardTechPermissions] = useState(
    defaultTechnicianPermissions,
  );
  const [wizardBadgeColor, setWizardBadgeColor] = useState<string>(
    TECHNICIAN_BADGE_PALETTE[0]?.bg ?? "#e0f2fe",
  );
  const [wizardVendorCompanyWide, setWizardVendorCompanyWide] = useState(false);
  const [wizardVendorActive, setWizardVendorActive] = useState(true);
  const [wizardManagementPermissions, setWizardManagementPermissions] = useState(
    defaultManagementPermissions,
  );

  const clearAdminAccess = useCallback(() => {
    clearRevealHideTimer();
    adminAccessRef.current = null;
    setAdminAccess(null);
  }, [clearRevealHideTimer]);

  const revokeCurrentAdminAccess = useCallback(async () => {
    const current = adminAccessRef.current;
    clearAdminAccess();
    if (!current) return;
    try {
      await revokeAdminAccessSessionClient({
        sessionToken: current.token,
        targetType: current.targetType,
        targetId: current.targetId,
      });
    } catch {
      // Revocation is best-effort on client exit paths; server TTL remains authoritative.
    }
  }, [clearAdminAccess]);

  useEffect(() => {
    adminAccessRef.current = adminAccess;
  }, [adminAccess]);

  useEffect(() => {
    if (!adminAccess) return;
    const expiresInMs = Math.max(
      0,
      new Date(adminAccess.expiresAt).getTime() - Date.now(),
    );
    const timeout = window.setTimeout(() => {
      void revokeCurrentAdminAccess();
    }, expiresInMs);
    return () => window.clearTimeout(timeout);
  }, [adminAccess, revokeCurrentAdminAccess]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      adminAccessRequestRef.current += 1;
      if (revealHideTimerRef.current !== null) {
        window.clearTimeout(revealHideTimerRef.current);
        revealHideTimerRef.current = null;
      }
      const current = adminAccessRef.current;
      adminAccessRef.current = null;
      if (current) {
        void revokeAdminAccessSessionClient({
          sessionToken: current.token,
          targetType: current.targetType,
          targetId: current.targetId,
        }).catch(() => undefined);
      }
    };
  }, []);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [techRows, vendorRows, managementResult] = await Promise.all([
        listTechnicians(),
        listVendors(),
        listManagementPinsClient().catch(() => ({
          pins: [] as ManagementPinPublic[],
        })),
      ]);
      setTechnicians(
        [...techRows].sort((a, b) => a.name.localeCompare(b.name)),
      );
      setVendors(
        [...vendorRows].sort((a, b) => a.name.localeCompare(b.name)),
      );
      setManagementPins(
        [...managementResult.pins].sort((a, b) =>
          a.label.localeCompare(b.label),
        ),
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not load PIN access.",
      );
    } finally {
      setLoading(false);
    }

    if (!canManageDispatchers) {
      setDispatchers([]);
      setAuthLoadError(null);
      setAuthLoading(false);
      return;
    }

    setAuthLoading(true);
    setAuthLoadError(null);
    try {
      const result = await listDispatchersClient();
      setDispatchers(
        [...result.dispatchers].sort((a, b) =>
          (a.email ?? a.uid).localeCompare(b.email ?? b.uid),
        ),
      );
    } catch (err) {
      setDispatchers([]);
      setAuthLoadError(
        err instanceof Error
          ? err.message
          : "Could not load Firebase Auth identities.",
      );
    } finally {
      setAuthLoading(false);
    }
  }, [canManageDispatchers]);

  useEffect(() => {
    void Promise.resolve().then(reload);
  }, [reload]);

  const rows: AccessRow[] = [
    ...dispatchers.map((dispatcher): AccessRow => ({
      type: dispatcher.manager ? "manager" : "dispatcher",
      id: dispatcher.uid,
      name: dispatcher.email ?? dispatcher.uid,
      active: dispatcher.active,
      accessMethod: "Email / Firebase Auth",
    })),
    ...technicians.map((technician): AccessRow => ({
      type: "technician",
      id: technician.id,
      name: technician.name,
      active: technician.active !== false,
      accessMethod: "PIN",
      hasPin: entityHasConfiguredPin(technician),
    })),
    ...vendors
      .filter(entityHasConfiguredPin)
      .map((vendor): AccessRow => ({
        type: "vendor",
        id: vendor.id,
        name: vendor.name,
        active: vendor.active !== false,
        accessMethod: "PIN",
        hasPin: true,
      })),
    ...managementPins.map((pin): AccessRow => ({
      type: "management",
      id: pin.id,
      name: pin.label,
      active: pin.active,
      accessMethod: "PIN",
      hasPin: pin.hasPin,
    })),
  ].sort((a, b) => a.name.localeCompare(b.name));

  const selectedDispatcher =
    selected?.type === "manager" || selected?.type === "dispatcher"
      ? dispatchers.find((row) => row.uid === selected.id)
      : undefined;
  const selectedTechnician =
    selected?.type === "technician"
      ? technicians.find((row) => row.id === selected.id)
      : undefined;
  const selectedVendor =
    selected?.type === "vendor"
      ? vendors.find((row) => row.id === selected.id)
      : undefined;
  const selectedManagementPin =
    selected?.type === "management"
      ? managementPins.find((row) => row.id === selected.id)
      : undefined;

  const selectAccess = async (row: AccessRow) => {
    adminAccessRequestRef.current += 1;
    setAdminAccessBusy(false);
    await revokeCurrentAdminAccess();
    setSelected({ type: row.type, id: row.id });
    setPinDraft("");
    setError(null);
    setMessage(null);
    if (row.type === "technician") {
      const technician = technicians.find((item) => item.id === row.id);
      setEditorDraft(
        technician
          ? {
              type: "technician",
              permissions: normalizeTechnicianPermissions(
                technician.permissions,
              ),
              badgeColor:
                technician.badgeColor &&
                SWATCH_OPTIONS.includes(technician.badgeColor)
                  ? technician.badgeColor
                  : defaultBadgeColorHex(technician.id),
              active: technician.active !== false,
            }
          : null,
      );
    } else if (row.type === "vendor") {
      const vendor = vendors.find((item) => item.id === row.id);
      setEditorDraft(
        vendor
          ? {
              type: "vendor",
              companyWideSessionEnabled:
                vendor.companyWideSessionEnabled === true,
              active: vendor.active !== false,
            }
          : null,
      );
    } else if (row.type === "management") {
      const pin = managementPins.find((item) => item.id === row.id);
      setEditorDraft(
        pin
          ? {
              type: "management",
              label: pin.label,
              permissions: normalizeManagementPermissions(pin.permissions),
              active: pin.active,
            }
          : null,
      );
    } else {
      setEditorDraft(null);
    }
  };

  const runMutation = async (
    id: string,
    work: () => Promise<void>,
    successMessage?: string,
  ) => {
    setBusyId(id);
    setError(null);
    setMessage(null);
    try {
      await work();
      if (successMessage) setMessage(successMessage);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save access.");
    } finally {
      setBusyId(null);
    }
  };

  const toggleActive = async (row: AccessRow) => {
    if (row.type === "manager" || row.type === "dispatcher") {
      if (!row.active) return;
      await runMutation(
        row.id,
        async () => {
          await deactivateDispatcherClient({ uid: row.id });
        },
        `${typeLabels[row.type]} account deactivated.`,
      );
      return;
    }
    if (row.type === "technician") {
      const technician = technicians.find((item) => item.id === row.id);
      if (!technician) return;
      await runMutation(row.id, async () => {
        await updateTechnician({
          ...technician,
          active: technician.active === false,
          updatedAt: new Date().toISOString(),
        });
      });
      return;
    }
    if (row.type === "vendor") {
      const vendor = vendors.find((item) => item.id === row.id);
      if (!vendor) return;
      await runMutation(row.id, async () => {
        await updateVendor({
          ...withoutPlaintextVendorPin(vendor),
          active: vendor.active === false,
          updatedAt: new Date().toISOString(),
        });
      });
      return;
    }
    const pin = managementPins.find((item) => item.id === row.id);
    if (!pin || pin.virtual) return;
    await runMutation(row.id, async () => {
      if (pin.active) {
        await deactivateManagementPinClient({ id: pin.id });
      } else {
        await upsertManagementPinClient({
          id: pin.id,
          label: pin.label,
          active: true,
          permissions: normalizeManagementPermissions(pin.permissions),
        });
      }
    });
  };

  const startAdminAccess = async (
    targetType: AccessPinTargetType,
    targetId: string,
  ) => {
    const requestId = adminAccessRequestRef.current + 1;
    adminAccessRequestRef.current = requestId;
    setAdminAccessBusy(true);
    setError(null);
    try {
      await revokeCurrentAdminAccess();
      const session = await startAdminAccessSessionClient({
        targetType,
        targetId,
      });
      if (
        !mountedRef.current ||
        adminAccessRequestRef.current !== requestId
      ) {
        await revokeAdminAccessSessionClient({
          sessionToken: session.sessionToken,
          targetType,
          targetId,
        }).catch(() => undefined);
        return;
      }
      const elevation: AdminAccessElevation = {
        token: session.sessionToken,
        targetType,
        targetId,
        expiresAt: session.expiresAt,
      };
      adminAccessRef.current = elevation;
      setAdminAccess(elevation);
      try {
        const reveal = await revealAccessPinClient({
          targetType,
          targetId,
          sessionToken: session.sessionToken,
        });
        if (
          !mountedRef.current ||
          adminAccessRequestRef.current !== requestId
        ) {
          await revokeAdminAccessSessionClient({
            sessionToken: session.sessionToken,
            targetType,
            targetId,
          }).catch(() => undefined);
          return;
        }
        const revealedElevation = {
          ...elevation,
          revealedPin: reveal.pin,
          pinHidden: false,
        };
        adminAccessRef.current = revealedElevation;
        setAdminAccess(revealedElevation);
        scheduleRevealHide(reveal.revealedForMs ?? 25000);
      } catch (err) {
        if (
          !mountedRef.current ||
          adminAccessRequestRef.current !== requestId
        ) {
          await revokeAdminAccessSessionClient({
            sessionToken: session.sessionToken,
            targetType,
            targetId,
          }).catch(() => undefined);
          return;
        }
        if (isRevealUnavailableError(err)) {
          const unavailableElevation = {
            ...elevation,
            revealUnavailable: true,
          };
          adminAccessRef.current = unavailableElevation;
          setAdminAccess(unavailableElevation);
        } else {
          await revokeCurrentAdminAccess();
          throw err;
        }
      }
    } catch (err) {
      if (
        mountedRef.current &&
        adminAccessRequestRef.current === requestId
      ) {
        setError(
          err instanceof Error ? err.message : "Could not start Admin Access.",
        );
      }
    } finally {
      if (
        mountedRef.current &&
        adminAccessRequestRef.current === requestId
      ) {
        setAdminAccessBusy(false);
      }
    }
  };

  const cancelEditor = async () => {
    adminAccessRequestRef.current += 1;
    setAdminAccessBusy(false);
    await revokeCurrentAdminAccess();
    setPinDraft("");
    setEditorDraft(null);
    setSelected(null);
    setError(null);
  };

  const savePinEditor = async (
    row: Extract<AccessRow, { type: PinUserType }>,
  ) => {
    if (adminAccessBusy) return;
    if (!editorDraft || editorDraft.type !== row.type) return;
    if (pinDraft && !/^\d{4,6}$/.test(pinDraft)) {
      setError("PIN must be 4–6 digits.");
      return;
    }
    const matchingElevation =
      adminAccess?.targetType === row.type &&
      adminAccess.targetId === row.id &&
      new Date(adminAccess.expiresAt).getTime() > Date.now()
        ? adminAccess
        : null;
    if (pinDraft && row.hasPin && !matchingElevation) {
      setError("Admin Access is required to change this PIN.");
      return;
    }

    setBusyId(row.id);
    setError(null);
    setMessage(null);
    try {
      const now = new Date().toISOString();
      if (row.type === "technician" && editorDraft.type === "technician") {
        const technician = technicians.find((item) => item.id === row.id);
        if (!technician) throw new Error("Technician not found.");
        await updateTechnician({
          ...withoutPlaintextTechnicianPin(technician),
          active: editorDraft.active,
          permissions: editorDraft.permissions,
          badgeColor: editorDraft.badgeColor,
          updatedAt: now,
        });
      } else if (row.type === "vendor" && editorDraft.type === "vendor") {
        const vendor = vendors.find((item) => item.id === row.id);
        if (!vendor) throw new Error("Vendor not found.");
        await updateVendor({
          ...withoutPlaintextVendorPin(vendor),
          active: editorDraft.active,
          companyWideSessionEnabled:
            editorDraft.companyWideSessionEnabled,
          updatedAt: now,
        });
      } else if (
        row.type === "management" &&
        editorDraft.type === "management"
      ) {
        await upsertManagementPinClient({
          id: row.id,
          label: editorDraft.label.trim(),
          active: editorDraft.active,
          permissions: editorDraft.permissions,
        });
      }

      if (pinDraft) {
        await setAccessPinClient({
          targetType: row.type,
          targetId: row.id,
          pin: pinDraft,
          sessionToken: row.hasPin ? matchingElevation?.token : undefined,
        });
      }

      setMessage("Changes saved");
      await revokeCurrentAdminAccess();
      setPinDraft("");
      setEditorDraft(null);
      setSelected(null);
      await reload();
    } catch (err) {
      if (isSessionValidityError(err)) {
        clearAdminAccess();
      }
      setError(err instanceof Error ? err.message : "Could not save changes.");
    } finally {
      setBusyId(null);
    }
  };

  const resetWizard = () => {
    setWizardOpen(false);
    setWizardStep(1);
    setWizardType("technician");
    setWizardName("");
    setWizardVendorId("");
    setWizardPin("");
    setWizardEmail("");
    setWizardTemporaryPassword("");
    setWizardTechPermissions(defaultTechnicianPermissions());
    setWizardBadgeColor(TECHNICIAN_BADGE_PALETTE[0]?.bg ?? "#e0f2fe");
    setWizardVendorCompanyWide(false);
    setWizardVendorActive(true);
    setWizardManagementPermissions(defaultManagementPermissions());
  };

  const wizardIsAuthType =
    wizardType === "manager" || wizardType === "dispatcher";
  const wizardNameIsValid =
    wizardType === "vendor"
      ? Boolean(wizardVendorId)
      : Boolean(wizardName.trim());

  const saveAuthWizard = async () => {
    if (!wizardIsAuthType || !wizardEmail.trim()) {
      setError("Email is required.");
      return;
    }
    setBusyId("__wizard__");
    setError(null);
    setMessage(null);
    setLastTempPassword(null);
    try {
      const result = await provisionDispatcherClient({
        email: wizardEmail.trim(),
        temporaryPassword: wizardTemporaryPassword.trim() || undefined,
        manager: wizardType === "manager",
      });
      setMessage(
        `${typeLabels[wizardType]} account created for ${result.email}. Share the temporary password securely.`,
      );
      setLastTempPassword(result.temporaryPassword);
      resetWizard();
      await reload();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not create Firebase Auth access.",
      );
    } finally {
      setBusyId(null);
    }
  };

  const saveWizard = async () => {
    if (!wizardNameIsValid || !/^\d{4,6}$/.test(wizardPin)) {
      setError("Name and a 4–6 digit PIN are required.");
      return;
    }
    setBusyId("__wizard__");
    setError(null);
    setMessage(null);
    try {
      if (wizardType === "technician") {
        const id = `tech-${crypto.randomUUID().slice(0, 8)}`;
        const now = new Date().toISOString();
        await createTechnician({
          id,
          name: wizardName.trim(),
          active: true,
          permissions: wizardTechPermissions,
          badgeColor: wizardBadgeColor || defaultBadgeColorHex(id),
          createdAt: now,
          updatedAt: now,
        });
        await setAccessPinClient({
          targetType: "technician",
          targetId: id,
          pin: wizardPin,
        });
      } else if (wizardType === "vendor") {
        const vendor = vendors.find((item) => item.id === wizardVendorId);
        if (!vendor) throw new Error("Select a vendor.");
        await updateVendor({
          ...withoutPlaintextVendorPin(vendor),
          active: wizardVendorActive,
          companyWideSessionEnabled: wizardVendorCompanyWide,
          updatedAt: new Date().toISOString(),
        });
        await setAccessPinClient({
          targetType: "vendor",
          targetId: vendor.id,
          pin: wizardPin,
        });
      } else {
        const created = await upsertManagementPinClient({
          label: wizardName.trim(),
          active: true,
          permissions: wizardManagementPermissions,
        });
        await setAccessPinClient({
          targetType: "management",
          targetId: created.id,
          pin: wizardPin,
        });
      }
      setMessage(`${typeLabels[wizardType]} access added.`);
      resetWizard();
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add access.");
    } finally {
      setBusyId(null);
    }
  };

  const renderWizard = () => (
    <div
      data-testid={wizardType === "management" ? "mgmt-pin-create" : "pin-access-wizard"}
      style={{
        margin: "0 20px 20px",
        padding: 16,
        border: "1px dashed var(--admin-border)",
        borderRadius: 8,
        backgroundColor: "var(--admin-surface-2)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          marginBottom: 14,
        }}
      >
        <strong style={{ color: "var(--admin-accent-soft)", fontSize: 15 }}>
          {wizardIsAuthType && wizardStep === 2
            ? `Add ${typeLabels[wizardType]} Access`
            : `Add Access · Step ${wizardStep} of 4`}
        </strong>
        <button type="button" onClick={resetWizard} style={secondaryButtonStyle}>
          Cancel
        </button>
      </div>

      {wizardStep === 1 && (
        <label style={{ display: "grid", gap: 6, maxWidth: 320, color: TEXT }}>
          User Type
          <select
            data-testid="pin-access-new-user-type"
            value={wizardType}
            onChange={(event) => setWizardType(event.target.value as UserType)}
            style={inputStyle}
          >
            {canManageDispatchers && (
              <>
                <option value="dispatcher">Dispatcher</option>
                <option value="manager">Manager</option>
              </>
            )}
            <option value="technician">Technician</option>
            <option value="vendor">Vendor</option>
            <option value="management">Management PIN</option>
          </select>
        </label>
      )}

      {wizardStep === 2 && wizardIsAuthType && (
        <div
          data-testid="dispatcher-users-provision-form"
          style={{ display: "grid", gap: 12, maxWidth: 520 }}
        >
          <label style={{ display: "grid", gap: 6, color: TEXT }}>
            Email
            <input
              data-testid="dispatcher-provision-email"
              type="email"
              value={wizardEmail}
              onChange={(event) => setWizardEmail(event.target.value)}
              style={inputStyle}
              placeholder="dispatcher@example.com"
            />
          </label>
          <label style={{ display: "grid", gap: 6, color: TEXT }}>
            Temporary password (optional)
            <input
              data-testid="dispatcher-provision-password"
              type="text"
              value={wizardTemporaryPassword}
              onChange={(event) =>
                setWizardTemporaryPassword(event.target.value)
              }
              style={inputStyle}
              placeholder="Auto-generated if blank"
            />
          </label>
        </div>
      )}

      {wizardStep === 2 &&
        !wizardIsAuthType &&
        (wizardType === "vendor" ? (
          <label style={{ display: "grid", gap: 6, maxWidth: 420, color: TEXT }}>
            Vendor
            <select
              data-testid="vendor-access-new-vendor"
              value={wizardVendorId}
              onChange={(event) => setWizardVendorId(event.target.value)}
              style={inputStyle}
            >
              <option value="">Select vendor…</option>
              {vendors.map((vendor) => (
                <option key={vendor.id} value={vendor.id}>
                  {vendor.name}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <label style={{ display: "grid", gap: 6, maxWidth: 420, color: TEXT }}>
            {wizardType === "technician" ? "Technician name" : "Management label"}
            <input
              data-testid={
                wizardType === "management"
                  ? "mgmt-pin-new-label"
                  : "technician-new-name"
              }
              type="text"
              value={wizardName}
              onChange={(event) => setWizardName(event.target.value)}
              style={inputStyle}
            />
          </label>
        ))}

      {wizardStep === 3 && (
        <label style={{ display: "grid", gap: 6, maxWidth: 260, color: TEXT }}>
          4–6 digit PIN
          <input
            data-testid={
              wizardType === "management"
                ? "mgmt-pin-new-code"
                : "pin-access-new-pin"
            }
            type="password"
            inputMode="numeric"
            maxLength={6}
            autoComplete="new-password"
            value={wizardPin}
            onChange={(event) =>
              setWizardPin(event.target.value.replace(/\D/g, "").slice(0, 6))
            }
            style={inputStyle}
          />
        </label>
      )}

      {wizardStep === 4 && wizardType === "technician" && (
        <div style={{ display: "grid", gap: 10, color: TEXT }}>
          <label>
            <input
              type="checkbox"
              checked={wizardTechPermissions.doorScan !== false}
              onChange={(event) =>
                setWizardTechPermissions((current) => ({
                  ...current,
                  doorScan: event.target.checked,
                }))
              }
            />{" "}
            Door scan
          </label>
          <label>
            <input
              type="checkbox"
              checked={wizardTechPermissions.receiveReleases !== false}
              onChange={(event) =>
                setWizardTechPermissions((current) => ({
                  ...current,
                  receiveReleases: event.target.checked,
                }))
              }
            />{" "}
            Receive releases
          </label>
          <label style={{ display: "grid", gap: 6, maxWidth: 260 }}>
            Badge color
            <select
              value={wizardBadgeColor}
              onChange={(event) => setWizardBadgeColor(event.target.value)}
              style={inputStyle}
            >
              {TECHNICIAN_BADGE_PALETTE.map((swatch) => (
                <option key={swatch.bg} value={swatch.bg}>
                  {swatch.bg}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      {wizardStep === 4 && wizardType === "vendor" && (
        <div style={{ display: "grid", gap: 10, color: TEXT }}>
          <label>
            <input
              data-testid="vendor-access-new-company-wide"
              type="checkbox"
              checked={wizardVendorCompanyWide}
              onChange={(event) =>
                setWizardVendorCompanyWide(event.target.checked)
              }
            />{" "}
            Multi-site run (company PIN)
          </label>
          <label>
            <input
              data-testid="vendor-access-new-active"
              type="checkbox"
              checked={wizardVendorActive}
              onChange={(event) => setWizardVendorActive(event.target.checked)}
            />{" "}
            Active
          </label>
        </div>
      )}

      {wizardStep === 4 && wizardType === "management" && (
        <div style={{ display: "grid", gap: 8, color: TEXT }}>
          {CAP_LABELS.map(({ key, label }) => (
            <label key={key}>
              <input
                data-testid={`mgmt-pin-new-cap-${key}`}
                type="checkbox"
                checked={wizardManagementPermissions[key]}
                onChange={(event) =>
                  setWizardManagementPermissions((current) => ({
                    ...current,
                    [key]: event.target.checked,
                  }))
                }
              />{" "}
              {label}
            </label>
          ))}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
        {wizardStep > 1 && (
          <button
            type="button"
            onClick={() => setWizardStep((step) => step - 1)}
            style={secondaryButtonStyle}
          >
            Back
          </button>
        )}
        {wizardIsAuthType && wizardStep === 2 ? (
          <button
            data-testid="dispatcher-provision-submit"
            type="button"
            disabled={busyId === "__wizard__" || !wizardEmail.trim()}
            onClick={() => void saveAuthWizard()}
            style={{
              ...primaryButtonStyle,
              opacity:
                busyId === "__wizard__" || !wizardEmail.trim() ? 0.55 : 1,
            }}
          >
            {busyId === "__wizard__" ? "Creating…" : "Save Access"}
          </button>
        ) : wizardStep < 4 ? (
          <button
            data-testid="pin-access-wizard-next"
            type="button"
            disabled={
              (wizardStep === 2 && !wizardIsAuthType && !wizardNameIsValid) ||
              (wizardStep === 3 && !/^\d{4,6}$/.test(wizardPin))
            }
            onClick={() => setWizardStep((step) => step + 1)}
            style={{
              ...primaryButtonStyle,
              opacity:
                (wizardStep === 2 && !wizardIsAuthType && !wizardNameIsValid) ||
                (wizardStep === 3 && !/^\d{4,6}$/.test(wizardPin))
                  ? 0.55
                  : 1,
            }}
          >
            Next
          </button>
        ) : (
          <button
            data-testid={
              wizardType === "management"
                ? "mgmt-pin-create-save"
                : "pin-access-create-save"
            }
            type="button"
            disabled={busyId === "__wizard__"}
            onClick={() => void saveWizard()}
            style={primaryButtonStyle}
          >
            {busyId === "__wizard__" ? "Saving…" : "Add Access"}
          </button>
        )}
      </div>
    </div>
  );

  const renderAuthDetail = (account: DispatcherAccountSummary) => {
    const type: AuthUserType = account.manager ? "manager" : "dispatcher";
    return (
      <div
        data-testid={`pin-access-auth-detail-${account.uid}`}
        style={{ display: "grid", gap: 14 }}
      >
        <label style={{ display: "grid", gap: 6, maxWidth: 520, color: TEXT }}>
          Email
          <input
            type="email"
            readOnly
            value={account.email ?? account.uid}
            style={{ ...inputStyle, color: "var(--admin-text-data)" }}
          />
        </label>
        <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
          <p style={{ margin: 0, color: TEXT }}>
            <span style={{ color: MUTED }}>Role:</span>{" "}
            <strong>{typeLabels[type]}</strong>
          </p>
          <p style={{ margin: 0, color: TEXT }}>
            <span style={{ color: MUTED }}>Status:</span>{" "}
            <strong>{account.active ? "Active" : "Inactive"}</strong>
          </p>
        </div>
        {account.active && (
          <div>
            <button
              data-testid={`dispatcher-deactivate-${account.uid}`}
              type="button"
              disabled={busyId === account.uid}
              onClick={() =>
                void toggleActive({
                  type,
                  id: account.uid,
                  name: account.email ?? account.uid,
                  active: account.active,
                  accessMethod: "Email / Firebase Auth",
                })
              }
              style={secondaryButtonStyle}
            >
              {busyId === account.uid ? "Deactivating…" : "Deactivate"}
            </button>
          </div>
        )}
      </div>
    );
  };

  const renderTechnicianDetail = (technician: Technician) => {
    if (editorDraft?.type !== "technician") return null;
    const permissions = editorDraft.permissions;
    const badgeStyle = resolveTechnicianBadgeStyle({
      ...technician,
      badgeColor: editorDraft.badgeColor,
    });
    const currentBadge = editorDraft.badgeColor;
    return (
      <div
        data-testid={`technician-row-${technician.id}`}
        style={{ display: "grid", gap: 14 }}
      >
        <div>
          <h3 style={{ margin: 0, color: "var(--admin-text-data)" }}>
            {technician.name}
          </h3>
          <span
            data-testid={`technician-badge-preview-${technician.id}`}
            style={{
              display: "inline-flex",
              marginTop: 6,
              padding: "3px 9px",
              borderRadius: 999,
              fontSize: 11,
              fontWeight: 700,
              backgroundColor: badgeStyle.bg,
              color: badgeStyle.text,
              border: `1px solid ${badgeStyle.border}`,
            }}
          >
            Released To
          </span>
        </div>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          <label style={{ color: TEXT }}>
            <input
              data-testid={`technician-perm-door-${technician.id}`}
              type="checkbox"
              checked={permissions.doorScan !== false}
              disabled={!editorDraft.active || busyId === technician.id}
              onChange={(event) =>
                setEditorDraft((current) =>
                  current?.type === "technician"
                    ? {
                        ...current,
                        permissions: {
                          ...current.permissions,
                          doorScan: event.target.checked,
                        },
                      }
                    : current,
                )
              }
            />{" "}
            Door scan
          </label>
          <label style={{ color: TEXT }}>
            <input
              data-testid={`technician-perm-release-${technician.id}`}
              type="checkbox"
              checked={permissions.receiveReleases !== false}
              disabled={!editorDraft.active || busyId === technician.id}
              onChange={(event) =>
                setEditorDraft((current) =>
                  current?.type === "technician"
                    ? {
                        ...current,
                        permissions: {
                          ...current.permissions,
                          receiveReleases: event.target.checked,
                        },
                      }
                    : current,
                )
              }
            />{" "}
            Receive releases
          </label>
        </div>
        <div
          data-testid={`technician-badge-color-${technician.id}`}
          style={{ display: "flex", flexWrap: "wrap", gap: 7, alignItems: "center" }}
        >
          <span style={{ color: MUTED, fontSize: 12 }}>Badge color:</span>
          {TECHNICIAN_BADGE_PALETTE.map((swatch) => (
            <button
              key={swatch.bg}
              data-testid={`technician-badge-swatch-${technician.id}-${swatch.bg.replace("#", "")}`}
              type="button"
              aria-label={`Badge color ${swatch.bg}`}
              disabled={!editorDraft.active || busyId === technician.id}
              onClick={() =>
                setEditorDraft((current) =>
                  current?.type === "technician"
                    ? { ...current, badgeColor: swatch.bg }
                    : current,
                )
              }
              style={{
                width: 22,
                height: 22,
                borderRadius: 4,
                border:
                  currentBadge === swatch.bg
                    ? `2px solid ${NAVY}`
                    : `1px solid ${swatch.border}`,
                backgroundColor: swatch.bg,
                cursor: "pointer",
              }}
            />
          ))}
        </div>
        <label style={{ color: TEXT }}>
          <input
            data-testid={`technician-active-toggle-${technician.id}`}
            type="checkbox"
            checked={editorDraft.active}
            disabled={busyId === technician.id}
            onChange={(event) =>
              setEditorDraft((current) =>
                current?.type === "technician"
                  ? { ...current, active: event.target.checked }
                  : current,
              )
            }
          />{" "}
          Active
        </label>
        {!technicianCanUseDoor({
          ...technician,
          permissions,
          active: editorDraft.active,
        }) && (
          <p style={{ color: MUTED, fontSize: 12, margin: 0 }}>
            Door scan disabled — PIN will not unlock the tech door.
          </p>
        )}
        {!technicianCanReceiveReleases({
          ...technician,
          permissions,
          active: editorDraft.active,
        }) && (
          <p style={{ color: MUTED, fontSize: 12, margin: 0 }}>
            Receive releases disabled — hidden from release lists.
          </p>
        )}
      </div>
    );
  };

  const renderVendorDetail = (vendor: Vendor) => {
    if (editorDraft?.type !== "vendor") return null;
    return (
      <div
        data-testid={`vendor-access-detail-${vendor.id}`}
        style={{ display: "grid", gap: 14 }}
      >
        <h3 style={{ margin: 0, color: "var(--admin-text-data)" }}>
          {vendor.name}
        </h3>
        <label style={{ color: TEXT }}>
          <input
            data-testid={`vendor-access-company-wide-${vendor.id}`}
            type="checkbox"
            checked={editorDraft.companyWideSessionEnabled}
            disabled={busyId === vendor.id}
            onChange={(event) =>
              setEditorDraft((current) =>
                current?.type === "vendor"
                  ? {
                      ...current,
                      companyWideSessionEnabled: event.target.checked,
                    }
                  : current,
              )
            }
          />{" "}
          Multi-site run (company PIN)
        </label>
        <label style={{ color: TEXT }}>
          <input
            data-testid={`vendor-access-active-${vendor.id}`}
            type="checkbox"
            checked={editorDraft.active}
            disabled={busyId === vendor.id}
            onChange={(event) =>
              setEditorDraft((current) =>
                current?.type === "vendor"
                  ? { ...current, active: event.target.checked }
                  : current,
              )
            }
          />{" "}
          Active
        </label>
      </div>
    );
  };

  const renderManagementDetail = (pin: ManagementPinPublic) => {
    if (editorDraft?.type !== "management") return null;
    const permissions = editorDraft.permissions;
    return (
      <div
        data-testid={`mgmt-pin-row-${pin.id}`}
        style={{ display: "grid", gap: 14 }}
      >
        <label style={{ display: "grid", gap: 6, maxWidth: 420, color: TEXT }}>
          Label
          <input
            data-testid={`mgmt-pin-label-${pin.id}`}
            type="text"
            value={editorDraft.label}
            disabled={busyId === pin.id}
            onChange={(event) =>
              setEditorDraft((current) =>
                current?.type === "management"
                  ? { ...current, label: event.target.value }
                  : current,
              )
            }
            style={inputStyle}
          />
        </label>
        {!pin.virtual && (
          <label style={{ color: TEXT }}>
            <input
              data-testid={`mgmt-pin-active-${pin.id}`}
              type="checkbox"
              checked={editorDraft.active}
              disabled={busyId === pin.id}
              onChange={(event) =>
                setEditorDraft((current) =>
                  current?.type === "management"
                    ? { ...current, active: event.target.checked }
                    : current,
                )
              }
            />{" "}
            Active
          </label>
        )}
        <div style={{ display: "grid", gap: 8 }}>
          {CAP_LABELS.map(({ key, label }) => (
            <label key={key} style={{ color: TEXT }}>
              <input
                data-testid={`mgmt-pin-cap-${pin.id}-${key}`}
                type="checkbox"
                checked={permissions[key]}
                disabled={busyId === pin.id || !editorDraft.active}
                onChange={(event) =>
                  setEditorDraft((current) =>
                    current?.type === "management"
                      ? {
                          ...current,
                          permissions: {
                            ...current.permissions,
                            [key]: event.target.checked,
                          },
                        }
                      : current,
                  )
                }
              />{" "}
              {label}
            </label>
          ))}
        </div>
      </div>
    );
  };

  const renderPinEditor = (
    row: Extract<AccessRow, { type: PinUserType }>,
  ) => {
    const elevation =
      adminAccess?.targetType === row.type && adminAccess.targetId === row.id
        ? adminAccess
        : null;
    const renderNewPinInput = () => (
      <label
        style={{
          display: "grid",
          gap: 6,
          maxWidth: 260,
          color: TEXT,
          fontWeight: 600,
        }}
      >
        New PIN
        <input
          data-testid="pin-access-new-pin-input"
          aria-label={`New PIN for ${row.name}`}
          type="password"
          inputMode="numeric"
          maxLength={6}
          autoComplete="new-password"
          placeholder="Optional 4–6 digit PIN"
          value={pinDraft}
          onChange={(event) =>
            setPinDraft(event.target.value.replace(/\D/g, "").slice(0, 6))
          }
          style={{ ...inputStyle, width: 180 }}
        />
      </label>
    );

    return (
      <div style={{ display: "grid", gap: 18 }}>
        <div
          data-testid="pin-access-admin-shell"
          style={{
            display: "grid",
            gap: 10,
            padding: 14,
            border: "1px solid var(--admin-border)",
            borderRadius: 8,
            backgroundColor: "var(--admin-surface)",
          }}
        >
          {elevation ? (
            <>
              <div style={{ display: "grid", gap: 4 }}>
                <span style={{ color: MUTED, fontSize: 12, fontWeight: 700 }}>
                  Current PIN
                </span>
                <strong
                  data-testid="pin-access-current-pin"
                  style={{
                    color: "var(--admin-text-data)",
                    fontSize: 15,
                    letterSpacing: elevation.revealedPin ? "0.12em" : 0,
                  }}
                >
                  {elevation.revealedPin ??
                    (elevation.revealUnavailable
                      ? "Not revealable — set a new PIN"
                      : elevation.pinHidden
                        ? "••••"
                        : "Checking current PIN…")}
                </strong>
              </div>
              {renderNewPinInput()}
              <span
                data-testid="pin-access-admin-active"
                style={{
                  color: "var(--admin-success-text)",
                  fontSize: 12,
                  fontWeight: 700,
                }}
              >
                Admin Access Active
              </span>
            </>
          ) : (
            <>
              <div style={{ display: "grid", gap: 4 }}>
                <span style={{ color: MUTED, fontSize: 12, fontWeight: 700 }}>
                  PIN
                </span>
                <strong
                  data-testid="pin-access-masked-pin"
                  style={{
                    color: "var(--admin-text-data)",
                    fontSize: 18,
                    letterSpacing: row.hasPin ? "0.18em" : 0,
                  }}
                >
                  {row.hasPin ? "••••" : "Not configured"}
                </strong>
              </div>
              <div>
                <button
                  data-testid="pin-access-admin-button"
                  type="button"
                  disabled={adminAccessBusy || busyId === row.id}
                  onClick={() => void startAdminAccess(row.type, row.id)}
                  style={{
                    ...secondaryButtonStyle,
                    minHeight: 36,
                    color: "var(--admin-accent-soft)",
                    opacity:
                      adminAccessBusy || busyId === row.id ? 0.55 : 1,
                  }}
                >
                  {adminAccessBusy ? "Starting…" : "Admin Access"}
                </button>
              </div>
              {!row.hasPin && renderNewPinInput()}
            </>
          )}
        </div>

        {row.type === "technician" &&
          selectedTechnician &&
          renderTechnicianDetail(selectedTechnician)}
        {row.type === "vendor" &&
          selectedVendor &&
          renderVendorDetail(selectedVendor)}
        {row.type === "management" &&
          selectedManagementPin &&
          renderManagementDetail(selectedManagementPin)}

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
            paddingTop: 4,
          }}
        >
          <button
            data-testid="pin-access-cancel"
            type="button"
            disabled={busyId === row.id}
            onClick={() => void cancelEditor()}
            style={secondaryButtonStyle}
          >
            Cancel
          </button>
          <button
            data-testid="pin-access-save"
            type="button"
            disabled={
              adminAccessBusy ||
              busyId === row.id ||
              Boolean(pinDraft && !/^\d{4,6}$/.test(pinDraft))
            }
            onClick={() => void savePinEditor(row)}
            style={{
              ...primaryButtonStyle,
              minHeight: 36,
              opacity:
                adminAccessBusy ||
                busyId === row.id ||
                Boolean(pinDraft && !/^\d{4,6}$/.test(pinDraft))
                  ? 0.55
                  : 1,
            }}
          >
            {busyId === row.id ? "Saving…" : "Save Changes"}
          </button>
        </div>
      </div>
    );
  };

  const renderExpandedDetail = (row: AccessRow) => {
    if (row.accessMethod === "Email / Firebase Auth") {
      if (!selectedDispatcher) return null;
      return (
        <div style={{ display: "grid", gap: 16 }}>
          {renderAuthDetail(selectedDispatcher)}
          <div>
            <button
              data-testid="pin-access-cancel"
              type="button"
              onClick={() => void cancelEditor()}
              style={secondaryButtonStyle}
            >
              Cancel
            </button>
          </div>
        </div>
      );
    }
    return renderPinEditor(row);
  };

  return (
    <section
      data-testid="pin-access-management-panel"
      style={{
        border: "1px solid var(--admin-border)",
        borderRadius: 8,
        backgroundColor: "var(--admin-surface)",
        boxShadow: "rgba(0,0,0,0.15) 0px 4px 12px 0px",
        color: TEXT,
        fontFamily: FONT,
        overflow: "hidden",
        marginBottom: 24,
      }}
    >
      <div data-testid="technician-settings-panel">
        <div
          style={{
            padding: "16px 20px",
            borderBottom: "1px solid var(--admin-border)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <div>
            <h2
              data-testid="pin-access-heading"
              style={{
                margin: 0,
                color: "var(--admin-accent-soft)",
                fontSize: 17,
              }}
            >
              PIN &amp; Access Management
            </h2>
            <p
              data-testid="pin-access-helper"
              style={{ margin: "5px 0 0", color: MUTED, fontSize: 12 }}
            >
              Manage access for managers, dispatchers, technicians, vendors, and
              management PINs in one place.
            </p>
          </div>
          <button
            data-testid="pin-access-add-button"
            type="button"
            onClick={() => {
              setLastTempPassword(null);
              setWizardOpen(true);
              setWizardStep(1);
            }}
            style={primaryButtonStyle}
          >
            Add Access
          </button>
        </div>

        {error && (
          <p
            role="alert"
            style={{
              margin: "14px 20px 0",
              color: "var(--admin-danger-text)",
              fontSize: 13,
            }}
          >
            {error}
          </p>
        )}
        {authLoadError && (
          <p
            data-testid="pin-access-auth-error"
            style={{
              margin: "14px 20px 0",
              color: "var(--admin-warning-text)",
              fontSize: 13,
            }}
          >
            Firebase Auth identities could not be loaded. PIN access remains
            available. {authLoadError}
          </p>
        )}
        {message && (
          <p
            role="status"
            style={{
              margin: "14px 20px 0",
              color: "var(--admin-success-text)",
              fontSize: 13,
            }}
          >
            {message}
          </p>
        )}
        {lastTempPassword && (
          <p
            data-testid="dispatcher-users-temp-password"
            style={{
              margin: "14px 20px 0",
              padding: "10px 12px",
              borderRadius: 6,
              backgroundColor: "var(--admin-surface-2)",
              color: "var(--admin-text-data)",
              fontSize: 13,
              fontFamily: "monospace",
            }}
          >
            Temporary password: {lastTempPassword}
          </p>
        )}

        {wizardOpen && renderWizard()}

        <div data-testid="mgmt-pins-section" style={{ padding: 20 }}>
          {loading ? (
            <p style={{ color: MUTED, fontSize: 14 }}>Loading access roster…</p>
          ) : (
            <>
              <div style={{ overflowX: "auto" }}>
                {authLoading && (
                  <p
                    data-testid="pin-access-auth-loading"
                    style={{ color: MUTED, fontSize: 13, margin: "0 0 10px" }}
                  >
                    Loading Firebase Auth identities…
                  </p>
                )}
                <table
                  data-testid="pin-access-roster"
                  style={{
                    width: "100%",
                    minWidth: 720,
                    borderCollapse: "collapse",
                    fontSize: 13,
                    color: TEXT,
                  }}
                >
                  <thead>
                    <tr style={{ backgroundColor: NAVY }}>
                      {[
                        "User Name / Email",
                        "User Type",
                        "Access Method",
                        "Status",
                        "Actions",
                      ].map((heading) => (
                          <th
                            key={heading}
                            style={{
                              padding: "11px 12px",
                              color: "var(--admin-on-navy)",
                              textAlign: "left",
                              fontWeight: 700,
                              whiteSpace: "nowrap",
                            }}
                          >
                            {heading}
                          </th>
                        ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, index) => {
                      const expanded =
                        selected?.type === row.type && selected.id === row.id;
                      return (
                        <Fragment key={`${row.type}-${row.id}`}>
                          <tr
                            data-testid={`pin-access-row-${row.type}-${row.id}`}
                            style={{
                              backgroundColor:
                                index % 2 === 0
                                  ? "var(--admin-row-even)"
                                  : "var(--admin-row-odd)",
                              opacity: row.active ? 1 : 0.72,
                            }}
                          >
                        <td
                          style={{
                            padding: 12,
                            borderBottom: "1px solid var(--admin-border)",
                            fontWeight: 700,
                          }}
                        >
                          {row.name}
                        </td>
                        <td
                          style={{
                            padding: 12,
                            borderBottom: "1px solid var(--admin-border)",
                          }}
                        >
                          <TypeChip type={row.type} />
                        </td>
                        <td
                          data-testid={
                            row.accessMethod === "PIN"
                              ? `pin-access-pin-state-${row.type}-${row.id}`
                              : `pin-access-auth-method-${row.id}`
                          }
                          style={{
                            padding: 12,
                            borderBottom: "1px solid var(--admin-border)",
                          }}
                        >
                          {row.accessMethod}
                        </td>
                        <td
                          style={{
                            padding: 12,
                            borderBottom: "1px solid var(--admin-border)",
                          }}
                        >
                          {row.active ? "Active" : "Inactive"}
                        </td>
                        <td
                          style={{
                            padding: 12,
                            borderBottom: "1px solid var(--admin-border)",
                            whiteSpace: "nowrap",
                          }}
                        >
                          <button
                            data-testid={`pin-access-edit-${row.type}-${row.id}`}
                            type="button"
                            onClick={() => void selectAccess(row)}
                            style={{ ...secondaryButtonStyle, marginRight: 8 }}
                          >
                            Edit
                          </button>
                          {(row.type === "manager" ||
                            row.type === "dispatcher") ? (
                            row.active && (
                              <button
                                data-testid={`pin-access-active-${row.type}-${row.id}`}
                                type="button"
                                disabled={busyId === row.id}
                                onClick={() => void toggleActive(row)}
                                style={secondaryButtonStyle}
                              >
                                Deactivate
                              </button>
                            )
                          ) : !(
                              row.type === "management" &&
                              managementPins.find((pin) => pin.id === row.id)
                                ?.virtual
                            ) && (
                            <button
                              data-testid={`pin-access-active-${row.type}-${row.id}`}
                              type="button"
                              disabled={busyId === row.id}
                              onClick={() => void toggleActive(row)}
                              style={secondaryButtonStyle}
                            >
                              {row.active ? "Deactivate" : "Reactivate"}
                            </button>
                          )}
                            </td>
                          </tr>
                          {expanded && (
                            <tr
                              data-testid={`pin-access-expanded-${row.type}-${row.id}`}
                              style={{
                                backgroundColor: "var(--admin-surface-2)",
                              }}
                            >
                              <td
                                colSpan={5}
                                style={{
                                  padding: 16,
                                  borderBottom:
                                    "1px solid var(--admin-border-strong)",
                                }}
                              >
                                <div
                                  data-testid="pin-access-detail"
                                  style={{
                                    padding: 16,
                                    border:
                                      "1px solid var(--admin-border)",
                                    borderRadius: 8,
                                    backgroundColor:
                                      "var(--admin-surface-2)",
                                  }}
                                >
                                  {renderExpandedDetail(row)}
                                </div>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {rows.length === 0 && (
                <p
                  data-testid="pin-access-empty"
                  style={{ color: MUTED, fontSize: 13, margin: "14px 0 0" }}
                >
                  No access identities yet.
                </p>
              )}
            </>
          )}
        </div>

      </div>
    </section>
  );
}
