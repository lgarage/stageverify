import { useState, useEffect, type CSSProperties, type FormEvent } from "react";
import type { ShopStockLocationMapping } from "./dispatcher/models";
import {
  listShopStockMappings,
  createShopStockMapping,
  updateShopStockMapping,
  deactivateShopStockMapping,
} from "./dispatcher/firestoreService";
import { formatMappingLocationHeader } from "./dispatcher/shopStockMapping";

const NAVY = "#0a3161";
const RED = "#bf0a30";
const FONT = '"Helvetica Neue", Helvetica, Arial, sans-serif';

const cardStyle: CSSProperties = {
  backgroundColor: "#fff",
  border: "1px solid #dde1e7",
  borderRadius: 8,
  boxShadow: "rgba(0,0,0,0.15) 0px 4px 12px 0px",
};

const labelStyle: CSSProperties = {
  display: "block",
  marginBottom: 6,
  fontSize: 12,
  fontWeight: 600,
  color: "#374151",
  fontFamily: FONT,
};

const inputStyle: CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "8px 12px",
  border: "1.5px solid #ccd0d7",
  borderRadius: 6,
  fontSize: 13,
  fontFamily: FONT,
  color: "#111",
  outline: "none",
};

interface MappingFormState {
  stockItemLabel: string;
  locationCode: string;
  combinationGroupLabel: string;
  memberLocationCodes: string;
  qtyAvailable: string;
  notes: string;
  active: boolean;
}

const emptyForm = (): MappingFormState => ({
  stockItemLabel: "",
  locationCode: "",
  combinationGroupLabel: "",
  memberLocationCodes: "",
  qtyAvailable: "0",
  notes: "",
  active: true,
});

function parseMemberCodes(raw: string, primaryCode: string): string[] | undefined {
  const fromText = raw
    .split(/[,;\n]/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (fromText.length === 0) return undefined;
  const codes = new Set(fromText);
  if (primaryCode.trim()) codes.add(primaryCode.trim());
  return [...codes];
}

export function ShopStockDirectoryPanel() {
  const [mappings, setMappings] = useState<ShopStockLocationMapping[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<MappingFormState>(emptyForm());

  const reload = async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await listShopStockMappings();
      setMappings(
        rows.sort((a, b) =>
          a.locationCode.localeCompare(b.locationCode, undefined, {
            numeric: true,
          }),
        ),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load mappings");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void reload();
  }, []);

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyForm());
    setShowForm(true);
  };

  const openEdit = (mapping: ShopStockLocationMapping) => {
    setEditingId(mapping.id);
    setForm({
      stockItemLabel: mapping.stockItemLabel,
      locationCode: mapping.locationCode,
      combinationGroupLabel: mapping.combinationGroupLabel ?? "",
      memberLocationCodes: (mapping.memberLocationCodes ?? [])
        .filter((c) => c !== mapping.locationCode)
        .join(", "),
      qtyAvailable: String(mapping.qtyAvailable),
      notes: mapping.notes ?? "",
      active: mapping.active,
    });
    setShowForm(true);
  };

  const cancelForm = () => {
    setShowForm(false);
    setEditingId(null);
    setForm(emptyForm());
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.stockItemLabel.trim() || !form.locationCode.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const qtyAvailable = Math.max(
        0,
        Number.parseInt(form.qtyAvailable, 10) || 0,
      );
      const memberLocationCodes = parseMemberCodes(
        form.memberLocationCodes,
        form.locationCode,
      );
      if (editingId) {
        const existing = mappings.find((m) => m.id === editingId);
        if (!existing) return;
        await updateShopStockMapping({
          ...existing,
          stockItemLabel: form.stockItemLabel.trim(),
          locationCode: form.locationCode.trim(),
          combinationGroupLabel: form.combinationGroupLabel.trim() || undefined,
          memberLocationCodes,
          qtyAvailable,
          notes: form.notes.trim() || undefined,
          active: form.active,
        });
      } else {
        await createShopStockMapping({
          stockItemLabel: form.stockItemLabel.trim(),
          locationCode: form.locationCode.trim(),
          combinationGroupLabel: form.combinationGroupLabel.trim() || undefined,
          memberLocationCodes,
          qtyAvailable,
          active: true,
          notes: form.notes.trim() || undefined,
        });
      }
      cancelForm();
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save mapping");
    } finally {
      setSaving(false);
    }
  };

  const handleDeactivate = async (mapping: ShopStockLocationMapping) => {
    if (
      !window.confirm(
        `Deactivate permanent mapping for ${formatMappingLocationHeader(mapping)}? The location(s) become available for vendor staging.`,
      )
    ) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await deactivateShopStockMapping(mapping.id);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to deactivate");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ ...cardStyle, overflow: "hidden" }} data-testid="shop-stock-directory">
      <div
        style={{
          padding: "15px 20px",
          borderBottom: "1px solid #eaecf0",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <div>
          <h2
            style={{
              margin: 0,
              fontSize: 16,
              fontWeight: 700,
              color: NAVY,
              fontFamily: FONT,
            }}
          >
            Shop Stock Directory
          </h2>
          <p
            style={{
              margin: "4px 0 0",
              fontSize: 12,
              color: "#6b7280",
              lineHeight: 1.45,
              fontFamily: FONT,
            }}
          >
            Permanent location mappings stay reserved for shop stock. Pickup
            updates qty accountability — not BuildOps inventory.
          </p>
        </div>
        {!showForm && (
          <button
            type="button"
            onClick={openCreate}
            style={{
              padding: "8px 16px",
              borderRadius: 6,
              border: "none",
              backgroundColor: NAVY,
              color: "#fff",
              fontWeight: 700,
              fontSize: 13,
              cursor: "pointer",
              fontFamily: FONT,
              flexShrink: 0,
            }}
          >
            Add Mapping
          </button>
        )}
      </div>

      {error && (
        <div
          style={{
            margin: "12px 20px 0",
            padding: "10px 12px",
            borderRadius: 6,
            backgroundColor: "#fef2f2",
            border: "1px solid #fecaca",
            color: "#b91c1c",
            fontSize: 13,
            fontFamily: FONT,
          }}
        >
          {error}
        </div>
      )}

      {showForm && (
        <form
          onSubmit={(e) => void handleSubmit(e)}
          style={{
            padding: 20,
            borderBottom: "1px solid #eaecf0",
            backgroundColor: "#f9fafb",
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
              gap: 12,
              marginBottom: 12,
            }}
          >
            <div>
              <label style={labelStyle}>Stock item label</label>
              <input
                style={inputStyle}
                value={form.stockItemLabel}
                onChange={(e) =>
                  setForm((f) => ({ ...f, stockItemLabel: e.target.value }))
                }
                placeholder="3/4-inch PVC fittings"
                required
              />
            </div>
            <div>
              <label style={labelStyle}>Primary location code</label>
              <input
                style={inputStyle}
                value={form.locationCode}
                onChange={(e) =>
                  setForm((f) => ({ ...f, locationCode: e.target.value }))
                }
                placeholder="S6F"
                required
              />
            </div>
            <div>
              <label style={labelStyle}>Combination label (optional)</label>
              <input
                style={inputStyle}
                value={form.combinationGroupLabel}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    combinationGroupLabel: e.target.value,
                  }))
                }
                placeholder="G15–G17"
              />
            </div>
            <div>
              <label style={labelStyle}>Member codes (optional)</label>
              <input
                style={inputStyle}
                value={form.memberLocationCodes}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    memberLocationCodes: e.target.value,
                  }))
                }
                placeholder="G15, G16, G17"
              />
            </div>
            <div>
              <label style={labelStyle}>Qty available</label>
              <input
                style={inputStyle}
                type="number"
                min={0}
                value={form.qtyAvailable}
                onChange={(e) =>
                  setForm((f) => ({ ...f, qtyAvailable: e.target.value }))
                }
              />
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <label style={labelStyle}>Notes</label>
              <input
                style={inputStyle}
                value={form.notes}
                onChange={(e) =>
                  setForm((f) => ({ ...f, notes: e.target.value }))
                }
                placeholder="PVC bin on shelf 6"
              />
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="submit"
              disabled={
                saving || !form.stockItemLabel.trim() || !form.locationCode.trim()
              }
              style={{
                padding: "8px 18px",
                borderRadius: 4,
                border: "none",
                backgroundColor: NAVY,
                color: "#fff",
                fontWeight: 700,
                fontSize: 13,
                cursor: saving ? "not-allowed" : "pointer",
                fontFamily: FONT,
              }}
            >
              {saving ? "Saving…" : editingId ? "Save Changes" : "Create Mapping"}
            </button>
            <button
              type="button"
              onClick={cancelForm}
              style={{
                padding: "8px 18px",
                borderRadius: 4,
                border: "1.5px solid #ccd0d7",
                backgroundColor: "#fff",
                color: "#6b7280",
                fontWeight: 700,
                fontSize: 13,
                cursor: "pointer",
                fontFamily: FONT,
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <div
          style={{
            padding: "32px 20px",
            textAlign: "center",
            color: "#6b7280",
            fontSize: 14,
            fontFamily: FONT,
          }}
        >
          Loading shop stock mappings…
        </div>
      ) : mappings.length === 0 ? (
        <div
          style={{
            padding: "32px 20px",
            textAlign: "center",
            color: "#6b7280",
            fontSize: 14,
            fontFamily: FONT,
          }}
        >
          No permanent mappings yet. Add one to reserve a stock location.
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontFamily: FONT,
              fontSize: 13,
            }}
          >
            <thead>
              <tr style={{ backgroundColor: "#f9fafb", textAlign: "left" }}>
                {[
                  "Location",
                  "Stock item",
                  "Qty avail",
                  "Assigned",
                  "Picked up",
                  "Status",
                  "",
                ].map((h) => (
                  <th
                    key={h}
                    style={{
                      padding: "10px 16px",
                      fontSize: 11,
                      fontWeight: 700,
                      color: "#6b7280",
                      textTransform: "uppercase",
                      letterSpacing: "0.06em",
                      borderBottom: "1px solid #eaecf0",
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {mappings.map((mapping) => (
                <tr
                  key={mapping.id}
                  data-testid="shop-stock-mapping-row"
                  style={{ borderBottom: "1px solid #f0f2f5" }}
                >
                  <td style={{ padding: "12px 16px", color: NAVY, fontWeight: 700 }}>
                    {formatMappingLocationHeader(mapping)}
                  </td>
                  <td style={{ padding: "12px 16px" }}>{mapping.stockItemLabel}</td>
                  <td style={{ padding: "12px 16px" }}>{mapping.qtyAvailable}</td>
                  <td style={{ padding: "12px 16px" }}>{mapping.qtyAssigned}</td>
                  <td style={{ padding: "12px 16px" }}>{mapping.qtyPickedUp}</td>
                  <td style={{ padding: "12px 16px" }}>
                    <span
                      style={{
                        display: "inline-block",
                        padding: "2px 8px",
                        borderRadius: 999,
                        fontSize: 11,
                        fontWeight: 700,
                        backgroundColor: mapping.active ? "#e8f4ea" : "#f3f4f6",
                        color: mapping.active ? "#2e7d32" : "#6b7280",
                      }}
                    >
                      {mapping.active ? "Reserved" : "Inactive"}
                    </span>
                  </td>
                  <td style={{ padding: "12px 16px", whiteSpace: "nowrap" }}>
                    <button
                      type="button"
                      onClick={() => openEdit(mapping)}
                      style={{
                        padding: "4px 10px",
                        marginRight: 6,
                        borderRadius: 4,
                        border: `1.5px solid ${NAVY}`,
                        backgroundColor: "#fff",
                        color: NAVY,
                        fontSize: 12,
                        fontWeight: 600,
                        cursor: "pointer",
                        fontFamily: FONT,
                      }}
                    >
                      Edit
                    </button>
                    {mapping.active && (
                      <button
                        type="button"
                        onClick={() => void handleDeactivate(mapping)}
                        style={{
                          padding: "4px 10px",
                          borderRadius: 4,
                          border: "1.5px solid #fca5a5",
                          backgroundColor: "#fff",
                          color: RED,
                          fontSize: 12,
                          fontWeight: 600,
                          cursor: "pointer",
                          fontFamily: FONT,
                        }}
                      >
                        Deactivate
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
