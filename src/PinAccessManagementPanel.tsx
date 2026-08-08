import { useCallback, useEffect, useState, type CSSProperties } from "react";
import type {
  Job,
  ManagementPinPermissions,
  ManagementPinPublic,
  Technician,
  TechnicianPermissions,
  Vendor,
} from "./dispatcher/models";
import {
  createTechnician,
  getTechnicianDayReleaseForDate,
  listJobs,
  listTechnicians,
  listVendors,
  updateTechnician,
  updateVendor,
} from "./dispatcher/firestoreService";
import {
  deactivateManagementPinClient,
  listManagementPinsClient,
  releaseJobsToTechnicianClient,
  upsertManagementPinClient,
} from "./phase2CallableClients";
import {
  technicianCanReceiveReleases,
  technicianCanUseDoor,
  todayReleaseDateUtc,
} from "./dispatcher/technicianReleaseHelpers";
import {
  defaultBadgeColorHex,
  resolveTechnicianBadgeStyle,
  SWATCH_OPTIONS,
  TECHNICIAN_BADGE_PALETTE,
} from "./dispatcher/technicianBadgeColors";

const NAVY = "#0a3161";
const TEXT = "#333";
const MUTED = "#6b7280";
const RED = "#bf0a30";
const FONT = '"Helvetica Neue", Helvetica, Arial, sans-serif';

const inputStyle: CSSProperties = {
  padding: "8px 10px",
  borderRadius: 6,
  border: "1px solid #ccd0d7",
  fontSize: 14,
  color: TEXT,
  backgroundColor: "#fff",
  fontFamily: FONT,
  boxSizing: "border-box",
};

const primaryButtonStyle: CSSProperties = {
  padding: "8px 14px",
  borderRadius: 6,
  border: "none",
  backgroundColor: NAVY,
  color: "#fff",
  fontSize: 13,
  fontWeight: 700,
  cursor: "pointer",
  fontFamily: FONT,
};

const secondaryButtonStyle: CSSProperties = {
  padding: "7px 12px",
  borderRadius: 6,
  border: "1px solid #ccd0d7",
  backgroundColor: "#fff",
  color: NAVY,
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

type UserType = "technician" | "vendor" | "management";

type SelectedAccess =
  | { type: "technician"; id: string }
  | { type: "vendor"; id: string }
  | { type: "management"; id: string };

type AccessRow =
  | { type: "technician"; id: string; name: string; active: boolean; hasPin: boolean }
  | { type: "vendor"; id: string; name: string; active: boolean; hasPin: true }
  | { type: "management"; id: string; name: string; active: boolean; hasPin: boolean };

const typeLabels: Record<UserType, string> = {
  technician: "Technician",
  vendor: "Vendor",
  management: "Management",
};

function TypeChip({ type }: { type: UserType }) {
  const colors: Record<UserType, { bg: string; color: string }> = {
    technician: { bg: "#e0f2fe", color: "#075985" },
    vendor: { bg: "#fef3c7", color: "#92400e" },
    management: { bg: "#ede9fe", color: "#5b21b6" },
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

export function PinAccessManagementPanel() {
  const [technicians, setTechnicians] = useState<Technician[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [managementPins, setManagementPins] = useState<ManagementPinPublic[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<SelectedAccess | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pinDraft, setPinDraft] = useState("");

  const [releaseTechnicianId, setReleaseTechnicianId] = useState("");
  const [releaseJobIds, setReleaseJobIds] = useState<Set<string>>(new Set());
  const [releaseMessage, setReleaseMessage] = useState<string | null>(null);

  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardStep, setWizardStep] = useState(1);
  const [wizardType, setWizardType] = useState<UserType>("technician");
  const [wizardName, setWizardName] = useState("");
  const [wizardVendorId, setWizardVendorId] = useState("");
  const [wizardPin, setWizardPin] = useState("");
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

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [techRows, vendorRows, jobRows, managementResult] =
        await Promise.all([
          listTechnicians(),
          listVendors(),
          listJobs(),
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
      setJobs(
        [...jobRows].sort((a, b) =>
          (a.jobName ?? a.id).localeCompare(b.jobName ?? b.id),
        ),
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
  }, []);

  useEffect(() => {
    void Promise.resolve().then(reload);
  }, [reload]);

  useEffect(() => {
    if (!releaseTechnicianId) return;
    let mounted = true;
    void getTechnicianDayReleaseForDate(
      releaseTechnicianId,
      todayReleaseDateUtc(),
    )
      .then((release) => {
        if (mounted) setReleaseJobIds(new Set(release?.jobIds ?? []));
      })
      .catch(() => {
        if (mounted) setReleaseJobIds(new Set());
      });
    return () => {
      mounted = false;
    };
  }, [releaseTechnicianId]);

  const rows: AccessRow[] = [
    ...technicians.map((technician): AccessRow => ({
      type: "technician",
      id: technician.id,
      name: technician.name,
      active: technician.active !== false,
      hasPin: Boolean(technician.pinCode || technician.pinHash),
    })),
    ...vendors
      .filter((vendor) => Boolean(vendor.pinCode || vendor.pinHash))
      .map((vendor): AccessRow => ({
        type: "vendor",
        id: vendor.id,
        name: vendor.name,
        active: vendor.active !== false,
        hasPin: true,
      })),
    ...managementPins.map((pin): AccessRow => ({
      type: "management",
      id: pin.id,
      name: pin.label,
      active: pin.active,
      hasPin: pin.hasPin,
    })),
  ].sort((a, b) => a.name.localeCompare(b.name));

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

  const selectAccess = (row: AccessRow) => {
    setSelected({ type: row.type, id: row.id });
    setPinDraft("");
    setError(null);
    setMessage(null);
    if (row.type === "technician") setReleaseTechnicianId(row.id);
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

  const saveTechnicianPin = async (technician: Technician) => {
    if (!/^\d{4}$/.test(pinDraft)) {
      setError("PIN must be exactly 4 digits.");
      return;
    }
    await runMutation(
      technician.id,
      async () => {
        await updateTechnician({
          ...technician,
          pinCode: pinDraft,
          updatedAt: new Date().toISOString(),
        });
        setPinDraft("");
      },
      `PIN updated for ${technician.name}.`,
    );
  };

  const saveVendorPin = async (vendor: Vendor) => {
    if (!/^\d{4}$/.test(pinDraft)) {
      setError("PIN must be exactly 4 digits.");
      return;
    }
    await runMutation(
      vendor.id,
      async () => {
        await updateVendor({
          ...withoutPlaintextVendorPin(vendor),
          pinCode: pinDraft,
          updatedAt: new Date().toISOString(),
        });
        setPinDraft("");
      },
      `PIN updated for ${vendor.name}.`,
    );
  };

  const saveManagementPin = async (pin: ManagementPinPublic) => {
    if (!/^\d{4}$/.test(pinDraft)) {
      setError("PIN must be exactly 4 digits.");
      return;
    }
    await runMutation(
      pin.id,
      async () => {
        await upsertManagementPinClient({
          id: pin.id,
          label: pin.label,
          pin: pinDraft,
          active: pin.active,
          permissions: normalizeManagementPermissions(pin.permissions),
        });
        setPinDraft("");
      },
      `PIN updated for ${pin.label}.`,
    );
  };

  const updateTechnicianPermissions = async (
    technician: Technician,
    patch: Partial<TechnicianPermissions>,
  ) => {
    await runMutation(technician.id, async () => {
      await updateTechnician({
        ...technician,
        permissions: {
          ...normalizeTechnicianPermissions(technician.permissions),
          ...patch,
        },
        updatedAt: new Date().toISOString(),
      });
    });
  };

  const saveTechnicianBadgeColor = async (
    technician: Technician,
    badgeColor: string,
  ) => {
    await runMutation(technician.id, async () => {
      await updateTechnician({
        ...technician,
        badgeColor,
        updatedAt: new Date().toISOString(),
      });
    });
  };

  const updateVendorOptions = async (
    vendor: Vendor,
    patch: Pick<Vendor, "active" | "companyWideSessionEnabled">,
  ) => {
    await runMutation(vendor.id, async () => {
      await updateVendor({
        ...withoutPlaintextVendorPin(vendor),
        ...patch,
        updatedAt: new Date().toISOString(),
      });
    });
  };

  const updateManagementPin = async (
    pin: ManagementPinPublic,
    patch: {
      label?: string;
      permissions?: ManagementPinPermissions;
    },
  ) => {
    await runMutation(pin.id, async () => {
      await upsertManagementPinClient({
        id: pin.id,
        label: patch.label ?? pin.label,
        active: pin.active,
        permissions:
          patch.permissions ?? normalizeManagementPermissions(pin.permissions),
      });
    });
  };

  const toggleReleaseJob = (jobId: string) => {
    setReleaseJobIds((current) => {
      const next = new Set(current);
      if (next.has(jobId)) next.delete(jobId);
      else next.add(jobId);
      return next;
    });
  };

  const saveReleaseJobs = async () => {
    if (!releaseTechnicianId) {
      setReleaseMessage("Select a technician.");
      return;
    }
    setBusyId("__release__");
    setReleaseMessage(null);
    try {
      const result = await releaseJobsToTechnicianClient({
        technicianId: releaseTechnicianId,
        jobIds: [...releaseJobIds],
        releaseDate: todayReleaseDateUtc(),
        replace: true,
      });
      setReleaseMessage(
        result.jobIds.length === 0
          ? `Cleared today's release list (${result.releaseDate}).`
          : `Set ${result.jobIds.length} job(s) for today (${result.releaseDate}).`,
      );
    } catch (err) {
      setReleaseMessage(
        err instanceof Error ? err.message : "Release failed.",
      );
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
    setWizardTechPermissions(defaultTechnicianPermissions());
    setWizardBadgeColor(TECHNICIAN_BADGE_PALETTE[0]?.bg ?? "#e0f2fe");
    setWizardVendorCompanyWide(false);
    setWizardVendorActive(true);
    setWizardManagementPermissions(defaultManagementPermissions());
  };

  const wizardNameIsValid =
    wizardType === "vendor"
      ? Boolean(wizardVendorId)
      : Boolean(wizardName.trim());

  const saveWizard = async () => {
    if (!wizardNameIsValid || !/^\d{4}$/.test(wizardPin)) {
      setError("Name and a 4-digit PIN are required.");
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
          pinCode: wizardPin,
          active: true,
          permissions: wizardTechPermissions,
          badgeColor: wizardBadgeColor || defaultBadgeColorHex(id),
          createdAt: now,
          updatedAt: now,
        });
      } else if (wizardType === "vendor") {
        const vendor = vendors.find((item) => item.id === wizardVendorId);
        if (!vendor) throw new Error("Select a vendor.");
        await updateVendor({
          ...withoutPlaintextVendorPin(vendor),
          pinCode: wizardPin,
          active: wizardVendorActive,
          companyWideSessionEnabled: wizardVendorCompanyWide,
          updatedAt: new Date().toISOString(),
        });
      } else {
        await upsertManagementPinClient({
          label: wizardName.trim(),
          pin: wizardPin,
          active: true,
          permissions: wizardManagementPermissions,
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
        border: "1px dashed #9ca3af",
        borderRadius: 8,
        backgroundColor: "#fafbfc",
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
        <strong style={{ color: NAVY, fontSize: 15 }}>
          Add Access · Step {wizardStep} of 4
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
            <option value="technician">Technician</option>
            <option value="vendor">Vendor</option>
            <option value="management">Management</option>
          </select>
        </label>
      )}

      {wizardStep === 2 &&
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
          4-digit PIN
          <input
            data-testid={
              wizardType === "management"
                ? "mgmt-pin-new-code"
                : "pin-access-new-pin"
            }
            type="password"
            inputMode="numeric"
            maxLength={4}
            autoComplete="new-password"
            value={wizardPin}
            onChange={(event) =>
              setWizardPin(event.target.value.replace(/\D/g, "").slice(0, 4))
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
        {wizardStep < 4 ? (
          <button
            data-testid="pin-access-wizard-next"
            type="button"
            disabled={
              (wizardStep === 2 && !wizardNameIsValid) ||
              (wizardStep === 3 && !/^\d{4}$/.test(wizardPin))
            }
            onClick={() => setWizardStep((step) => step + 1)}
            style={{
              ...primaryButtonStyle,
              opacity:
                (wizardStep === 2 && !wizardNameIsValid) ||
                (wizardStep === 3 && !/^\d{4}$/.test(wizardPin))
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

  const renderTechnicianDetail = (technician: Technician) => {
    const permissions = normalizeTechnicianPermissions(technician.permissions);
    const badgeStyle = resolveTechnicianBadgeStyle(technician);
    const currentBadge =
      technician.badgeColor && SWATCH_OPTIONS.includes(technician.badgeColor)
        ? technician.badgeColor
        : defaultBadgeColorHex(technician.id);
    return (
      <div
        data-testid={`technician-row-${technician.id}`}
        style={{ display: "grid", gap: 14 }}
      >
        <div>
          <h3 style={{ margin: 0, color: NAVY }}>{technician.name}</h3>
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
              disabled={technician.active === false || busyId === technician.id}
              onChange={(event) =>
                void updateTechnicianPermissions(technician, {
                  doorScan: event.target.checked,
                })
              }
            />{" "}
            Door scan
          </label>
          <label style={{ color: TEXT }}>
            <input
              data-testid={`technician-perm-release-${technician.id}`}
              type="checkbox"
              checked={permissions.receiveReleases !== false}
              disabled={technician.active === false || busyId === technician.id}
              onChange={(event) =>
                void updateTechnicianPermissions(technician, {
                  receiveReleases: event.target.checked,
                })
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
              disabled={technician.active === false || busyId === technician.id}
              onClick={() =>
                void saveTechnicianBadgeColor(technician, swatch.bg)
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
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input
            data-testid={`technician-pin-input-${technician.id}`}
            aria-label={`Change PIN for ${technician.name}`}
            type="password"
            inputMode="numeric"
            maxLength={4}
            autoComplete="new-password"
            placeholder="New 4-digit PIN"
            value={pinDraft}
            onChange={(event) =>
              setPinDraft(event.target.value.replace(/\D/g, "").slice(0, 4))
            }
            style={{ ...inputStyle, width: 160 }}
          />
          <button
            data-testid={`technician-pin-save-${technician.id}`}
            type="button"
            disabled={busyId === technician.id || !/^\d{4}$/.test(pinDraft)}
            onClick={() => void saveTechnicianPin(technician)}
            style={primaryButtonStyle}
          >
            Change PIN
          </button>
          <button
            data-testid={`technician-active-toggle-${technician.id}`}
            type="button"
            disabled={busyId === technician.id}
            onClick={() =>
              void toggleActive({
                type: "technician",
                id: technician.id,
                name: technician.name,
                active: technician.active !== false,
                hasPin: Boolean(technician.pinCode || technician.pinHash),
              })
            }
            style={secondaryButtonStyle}
          >
            {technician.active === false ? "Reactivate" : "Deactivate"}
          </button>
        </div>
        {!technicianCanUseDoor(technician) && (
          <p style={{ color: MUTED, fontSize: 12, margin: 0 }}>
            Door scan disabled — PIN will not unlock the tech door.
          </p>
        )}
        {!technicianCanReceiveReleases(technician) && (
          <p style={{ color: MUTED, fontSize: 12, margin: 0 }}>
            Receive releases disabled — hidden from release lists.
          </p>
        )}

        <div style={{ borderTop: "1px solid #e5e7eb", paddingTop: 14 }}>
          <h3 style={{ fontSize: 15, color: NAVY, margin: "0 0 6px" }}>
            Release jobs for today
          </h3>
          <p style={{ fontSize: 12, color: MUTED, margin: "0 0 10px" }}>
            Checked jobs are released for the selected technician today.
          </p>
          <select
            data-testid="technician-release-select"
            value={releaseTechnicianId}
            onChange={(event) => setReleaseTechnicianId(event.target.value)}
            style={{ ...inputStyle, width: "100%", maxWidth: 360 }}
          >
            <option value="">Select technician…</option>
            {technicians.filter(technicianCanReceiveReleases).map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
          <div
            data-testid="technician-release-job-list"
            style={{
              maxHeight: 180,
              overflowY: "auto",
              border: "1px solid #e5e7eb",
              borderRadius: 6,
              padding: 8,
              margin: "10px 0",
            }}
          >
            {jobs.map((job) => (
              <label
                key={job.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  color: TEXT,
                  fontSize: 13,
                  padding: "4px 0",
                }}
              >
                <input
                  type="checkbox"
                  checked={releaseJobIds.has(job.id)}
                  onChange={() => toggleReleaseJob(job.id)}
                />
                {job.jobName ?? job.id}
              </label>
            ))}
          </div>
          <button
            data-testid="technician-release-save"
            type="button"
            disabled={busyId === "__release__"}
            onClick={() => void saveReleaseJobs()}
            style={primaryButtonStyle}
          >
            {busyId === "__release__" ? "Saving…" : "Save today's release list"}
          </button>
          {releaseMessage && (
            <p style={{ color: TEXT, fontSize: 13 }}>{releaseMessage}</p>
          )}
        </div>
      </div>
    );
  };

  const renderVendorDetail = (vendor: Vendor) => (
    <div
      data-testid={`vendor-access-detail-${vendor.id}`}
      style={{ display: "grid", gap: 14 }}
    >
      <div>
        <h3 style={{ margin: 0, color: NAVY }}>{vendor.name}</h3>
        <p
          data-testid={`vendor-access-pin-state-${vendor.id}`}
          style={{ margin: "5px 0 0", color: MUTED, fontSize: 12 }}
        >
          {vendor.pinCode || vendor.pinHash ? "PIN configured" : "No PIN configured"}
        </p>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input
          data-testid={`vendor-access-pin-input-${vendor.id}`}
          aria-label={`Change PIN for ${vendor.name}`}
          type="password"
          inputMode="numeric"
          maxLength={4}
          autoComplete="new-password"
          placeholder="New 4-digit PIN"
          value={pinDraft}
          onChange={(event) =>
            setPinDraft(event.target.value.replace(/\D/g, "").slice(0, 4))
          }
          style={{ ...inputStyle, width: 160 }}
        />
        <button
          data-testid={`vendor-access-pin-save-${vendor.id}`}
          type="button"
          disabled={busyId === vendor.id || !/^\d{4}$/.test(pinDraft)}
          onClick={() => void saveVendorPin(vendor)}
          style={primaryButtonStyle}
        >
          Change PIN
        </button>
      </div>
      <label style={{ color: TEXT }}>
        <input
          data-testid={`vendor-access-company-wide-${vendor.id}`}
          type="checkbox"
          checked={vendor.companyWideSessionEnabled === true}
          disabled={busyId === vendor.id}
          onChange={(event) =>
            void updateVendorOptions(vendor, {
              active: vendor.active !== false,
              companyWideSessionEnabled: event.target.checked,
            })
          }
        />{" "}
        Multi-site run (company PIN)
      </label>
      <label style={{ color: TEXT }}>
        <input
          data-testid={`vendor-access-active-${vendor.id}`}
          type="checkbox"
          checked={vendor.active !== false}
          disabled={busyId === vendor.id}
          onChange={(event) =>
            void updateVendorOptions(vendor, {
              active: event.target.checked,
              companyWideSessionEnabled:
                vendor.companyWideSessionEnabled === true,
            })
          }
        />{" "}
        Active
      </label>
    </div>
  );

  const renderManagementDetail = (pin: ManagementPinPublic) => {
    const permissions = normalizeManagementPermissions(pin.permissions);
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
            defaultValue={pin.label}
            disabled={busyId === pin.id}
            onBlur={(event) => {
              const label = event.target.value.trim();
              if (label && label !== pin.label) {
                void updateManagementPin(pin, { label });
              }
            }}
            style={inputStyle}
          />
        </label>
        <p style={{ margin: 0, color: MUTED, fontSize: 12 }}>
          {pin.hasPin ? "PIN configured" : "No PIN configured"} ·{" "}
          {pin.active ? "Active" : "Inactive"}
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input
            data-testid={`mgmt-pin-input-${pin.id}`}
            aria-label={`Change PIN for ${pin.label}`}
            type="password"
            inputMode="numeric"
            maxLength={4}
            autoComplete="new-password"
            placeholder="New 4-digit PIN"
            value={pinDraft}
            onChange={(event) =>
              setPinDraft(event.target.value.replace(/\D/g, "").slice(0, 4))
            }
            style={{ ...inputStyle, width: 160 }}
          />
          <button
            data-testid={`mgmt-pin-save-${pin.id}`}
            type="button"
            disabled={busyId === pin.id || !/^\d{4}$/.test(pinDraft)}
            onClick={() => void saveManagementPin(pin)}
            style={primaryButtonStyle}
          >
            Change PIN
          </button>
          {!pin.virtual && (
            <button
              data-testid={`mgmt-pin-deactivate-${pin.id}`}
              type="button"
              disabled={busyId === pin.id}
              onClick={() =>
                void toggleActive({
                  type: "management",
                  id: pin.id,
                  name: pin.label,
                  active: pin.active,
                  hasPin: pin.hasPin,
                })
              }
              style={secondaryButtonStyle}
            >
              {pin.active ? "Deactivate" : "Reactivate"}
            </button>
          )}
        </div>
        <div style={{ display: "grid", gap: 8 }}>
          {CAP_LABELS.map(({ key, label }) => (
            <label key={key} style={{ color: TEXT }}>
              <input
                data-testid={`mgmt-pin-cap-${pin.id}-${key}`}
                type="checkbox"
                checked={permissions[key]}
                disabled={busyId === pin.id || !pin.active}
                onChange={(event) =>
                  void updateManagementPin(pin, {
                    permissions: {
                      ...permissions,
                      [key]: event.target.checked,
                    },
                  })
                }
              />{" "}
              {label}
            </label>
          ))}
        </div>
      </div>
    );
  };

  return (
    <section
      data-testid="pin-access-management-panel"
      style={{
        border: "1px solid #dde1e7",
        borderRadius: 8,
        backgroundColor: "#fff",
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
            borderBottom: "1px solid #e5e7eb",
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
              style={{ margin: 0, color: NAVY, fontSize: 17 }}
            >
              PIN &amp; Access Management
            </h2>
            <p
              data-testid="pin-access-helper"
              style={{ margin: "5px 0 0", color: MUTED, fontSize: 12 }}
            >
              Manage technician, company vendor, and management PIN access in one place.
            </p>
          </div>
          <button
            data-testid="pin-access-add-button"
            type="button"
            onClick={() => {
              setWizardOpen(true);
              setWizardStep(1);
            }}
            style={primaryButtonStyle}
          >
            Add Access
          </button>
        </div>

        {error && (
          <p role="alert" style={{ margin: "14px 20px 0", color: RED, fontSize: 13 }}>
            {error}
          </p>
        )}
        {message && (
          <p role="status" style={{ margin: "14px 20px 0", color: "#166534", fontSize: 13 }}>
            {message}
          </p>
        )}

        {wizardOpen && renderWizard()}

        <div data-testid="mgmt-pins-section" style={{ padding: 20 }}>
          {loading ? (
            <p style={{ color: MUTED, fontSize: 14 }}>Loading access roster…</p>
          ) : (
            <>
              <div style={{ overflowX: "auto" }}>
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
                      {["User Name", "User Type", "PIN", "Status", "Actions"].map(
                        (heading) => (
                          <th
                            key={heading}
                            style={{
                              padding: "11px 12px",
                              color: "#fff",
                              textAlign: "left",
                              fontWeight: 700,
                              whiteSpace: "nowrap",
                            }}
                          >
                            {heading}
                          </th>
                        ),
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, index) => (
                      <tr
                        key={`${row.type}-${row.id}`}
                        data-testid={`pin-access-row-${row.type}-${row.id}`}
                        style={{
                          backgroundColor: index % 2 === 0 ? "#fff" : "#fafbfc",
                          opacity: row.active ? 1 : 0.72,
                        }}
                      >
                        <td style={{ padding: 12, borderBottom: "1px solid #e5e7eb", fontWeight: 700 }}>
                          {row.name}
                        </td>
                        <td style={{ padding: 12, borderBottom: "1px solid #e5e7eb" }}>
                          <TypeChip type={row.type} />
                        </td>
                        <td
                          data-testid={`pin-access-pin-state-${row.type}-${row.id}`}
                          style={{ padding: 12, borderBottom: "1px solid #e5e7eb" }}
                        >
                          {row.hasPin ? "••••" : "Not configured"}
                        </td>
                        <td style={{ padding: 12, borderBottom: "1px solid #e5e7eb" }}>
                          {row.active ? "Active" : "Inactive"}
                        </td>
                        <td style={{ padding: 12, borderBottom: "1px solid #e5e7eb", whiteSpace: "nowrap" }}>
                          <button
                            data-testid={`pin-access-edit-${row.type}-${row.id}`}
                            type="button"
                            onClick={() => selectAccess(row)}
                            style={{ ...secondaryButtonStyle, marginRight: 8 }}
                          >
                            Edit
                          </button>
                          {!(row.type === "management" && managementPins.find((pin) => pin.id === row.id)?.virtual) && (
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
                    ))}
                  </tbody>
                </table>
              </div>
              {rows.length === 0 && (
                <p
                  data-testid="pin-access-empty"
                  style={{ color: MUTED, fontSize: 13, margin: "14px 0 0" }}
                >
                  No PIN access entries yet.
                </p>
              )}
            </>
          )}
        </div>

        {selected && (
          <div
            data-testid="pin-access-detail"
            style={{
              margin: "0 20px 20px",
              padding: 16,
              border: "1px solid #dbe3ed",
              borderRadius: 8,
              backgroundColor: "#fff",
            }}
          >
            {selectedTechnician && renderTechnicianDetail(selectedTechnician)}
            {selectedVendor && renderVendorDetail(selectedVendor)}
            {selectedManagementPin &&
              renderManagementDetail(selectedManagementPin)}
          </div>
        )}
      </div>
    </section>
  );
}
