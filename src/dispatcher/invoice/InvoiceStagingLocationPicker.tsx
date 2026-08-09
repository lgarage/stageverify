import { useMemo, useState, type CSSProperties } from "react";
import { isLocationActive } from "../models";
import { formatStagingCodeCanonical } from "../stagingCode";
import { stagingSpotChipStyle } from "../drawer/DrawerStagingLocationChips";
import { resolveSpotColor } from "../resolveSpotColor";
import { useLiveZoneOccupancy } from "../useLiveZoneOccupancy";
import { normalizeStagingCodeKey } from "../stagingCode";

const FONT = '"Helvetica Neue", Helvetica, Arial, sans-serif';

type Props = {
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
  font?: string;
  /** Controlled picker open state (Assign Location footer flow). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Fired when user taps Done with a non-empty selection. May return a Promise — picker stays open until it resolves. */
  onDone?: (ids: string[]) => void | Promise<void>;
};

/**
 * Pre-approve staging picker — same occupancy SoT as Staging Map / drawer chips
 * (useLiveZoneOccupancy + spot colors). Selection is local until Approve CF writes
 * plannedStagingLocationIds (no client write path).
 */
export function InvoiceStagingLocationPicker({
  selectedIds,
  onChange,
  disabled = false,
  font = FONT,
  open: controlledOpen,
  onOpenChange,
  onDone,
}: Props) {
  const [internalOpen, setInternalOpen] = useState(false);
  const pickerOpen = controlledOpen ?? internalOpen;
  const setPickerOpen = (next: boolean) => {
    if (onOpenChange) onOpenChange(next);
    else setInternalOpen(next);
  };
  const live = useLiveZoneOccupancy(true);

  const activeZones = useMemo(
    () =>
      live.zones
        .filter(isLocationActive)
        .slice()
        .sort((a, b) =>
          formatStagingCodeCanonical(a.code).localeCompare(
            formatStagingCodeCanonical(b.code),
            undefined,
            { numeric: true, sensitivity: "base" },
          ),
        ),
    [live.zones],
  );

  const selectedCodes = useMemo(() => {
    const byId = new Map(activeZones.map((z) => [z.id, z]));
    return selectedIds
      .map((id) => byId.get(id)?.code)
      .filter((code): code is string => Boolean(code?.trim()))
      .map((code) => formatStagingCodeCanonical(code));
  }, [activeZones, selectedIds]);

  const toggleId = (id: string) => {
    if (disabled) return;
    if (selectedIds.includes(id)) {
      onChange(selectedIds.filter((x) => x !== id));
    } else {
      onChange([...selectedIds, id]);
    }
  };

  const panelStyle: CSSProperties = {
    marginTop: 10,
    padding: 12,
    backgroundColor: "var(--admin-surface)",
    border: "1px solid var(--admin-border)",
    borderRadius: 8,
  };

  if (!pickerOpen) {
    if (selectedIds.length === 0) {
      return (
        <button
          type="button"
          data-testid="invoice-staging-choose"
          disabled={disabled}
          onClick={() => setPickerOpen(true)}
          style={{
            backgroundColor: "var(--admin-surface)",
            color: "var(--admin-text-label)",
            border: "1px solid var(--admin-border)",
            borderRadius: 6,
            padding: "10px 16px",
            fontSize: 13,
            fontWeight: 700,
            fontFamily: font,
            cursor: disabled ? "not-allowed" : "pointer",
          }}
        >
          Choose Staging Location
        </button>
      );
    }
    return (
      <div data-testid="invoice-staging-picker-summary">
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: 8,
          }}
        >
          {selectedCodes.map((code) => {
            const color = resolveSpotColor(
              code,
              live.occupancyByZoneCode,
              live.shopStockByCode,
            );
            return (
              <span
                key={code}
                data-testid={`invoice-staging-chip-${normalizeStagingCodeKey(code)}`}
                style={stagingSpotChipStyle(color)}
              >
                {code}
              </span>
            );
          })}
          <button
            type="button"
            data-testid="invoice-staging-change"
            disabled={disabled}
            onClick={() => setPickerOpen(true)}
            style={{
              backgroundColor: "var(--admin-surface)",
              color: "var(--admin-text-label)",
              border: "1px solid var(--admin-border)",
              borderRadius: 6,
              padding: "6px 12px",
              fontSize: 12,
              fontWeight: 700,
              fontFamily: font,
              cursor: disabled ? "not-allowed" : "pointer",
            }}
          >
            Change
          </button>
        </div>
      </div>
    );
  }

  return (
    <div data-testid="invoice-staging-picker" style={panelStyle}>
      {!live.ready ? (
        <p
          data-testid="invoice-staging-picker-loading"
          style={{
            margin: 0,
            fontSize: 13,
            color: "var(--admin-text-secondary)",
            fontFamily: font,
          }}
        >
          Loading staging locations…
        </p>
      ) : activeZones.length === 0 ? (
        <p
          data-testid="invoice-staging-picker-empty"
          style={{
            margin: 0,
            fontSize: 13,
            color: "var(--admin-text-secondary)",
            fontFamily: font,
          }}
        >
          No active staging locations available.
        </p>
      ) : (
        <>
          <p
            style={{
              margin: "0 0 10px",
              fontSize: 12,
              color: "var(--admin-text-secondary)",
              fontFamily: font,
              fontWeight: 500,
            }}
          >
            Tap spots to select (same locations as the Staging Map).{" "}
            {selectedIds.length > 0
              ? `${selectedIds.length} selected.`
              : "None selected."}
          </p>
          <div
            data-testid="invoice-staging-picker-grid"
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 8,
            }}
          >
            {activeZones.map((zone) => {
              const code = formatStagingCodeCanonical(zone.code);
              const selected = selectedIds.includes(zone.id);
              const color = resolveSpotColor(
                code,
                live.occupancyByZoneCode,
                live.shopStockByCode,
              );
              return (
                <button
                  key={zone.id}
                  type="button"
                  data-testid={`invoice-staging-option-${normalizeStagingCodeKey(code)}`}
                  disabled={disabled}
                  aria-pressed={selected}
                  onClick={() => toggleId(zone.id)}
                  style={{
                    ...stagingSpotChipStyle(color),
                    cursor: disabled ? "not-allowed" : "pointer",
                    outline: selected
                      ? "2px solid var(--admin-accent, #0a3161)"
                      : "none",
                    outlineOffset: 2,
                    opacity: selected ? 1 : 0.85,
                  }}
                  title={zone.label || code}
                >
                  {code}
                </button>
              );
            })}
          </div>
          {selectedIds.length > 0 && (
            <button
              type="button"
              data-testid="invoice-staging-done"
              disabled={disabled}
              onClick={() => {
                const maybePromise = onDone?.(selectedIds);
                if (maybePromise && typeof (maybePromise as Promise<void>).then === "function") {
                  void (maybePromise as Promise<void>).then(
                    () => setPickerOpen(false),
                    () => {
                      /* keep open — parent reverts selection / shows toast */
                    },
                  );
                  return;
                }
                setPickerOpen(false);
              }}
              style={{
                marginTop: 12,
                backgroundColor: "#0a3161",
                color: "var(--admin-on-navy, #fff)",
                border: "none",
                borderRadius: 6,
                padding: "8px 14px",
                fontSize: 12,
                fontWeight: 700,
                fontFamily: font,
                cursor: disabled ? "not-allowed" : "pointer",
              }}
            >
              Done
            </button>
          )}
        </>
      )}
    </div>
  );
}
