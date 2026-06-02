import { useEffect, useMemo, useState, type CSSProperties, type FormEvent } from "react";
import type { Job, Vendor, StagingLocation } from "./dispatcher/models";
import { isLocationActive } from "./dispatcher/models";
import {
  createDelivery,
  firestoreDataService,
  listJobs,
  listVendors,
  mapOccupancyByLocationId,
} from "./dispatcher/firestoreService";
import { isStagingLocationOccupiedError } from "./dispatcher/stagingOccupancy";

const NAVY = "#0a3161";
const RED = "#bf0a30";
const FONT = '"Helvetica Neue", Helvetica, Arial, sans-serif';

interface CreateDeliveryModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}

interface LineItemRow {
  sku: string;
  description: string;
  qtyOrdered: number;
}

const EMPTY_LINE_ITEM: LineItemRow = {
  sku: "",
  description: "",
  qtyOrdered: 1,
};

const labelStyle: CSSProperties = {
  display: "block",
  fontSize: 13,
  fontWeight: 700,
  color: "#6b7280",
  marginBottom: 6,
};

const inputStyle: CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  border: "1.5px solid #ccd0d7",
  borderRadius: 6,
  fontSize: 14,
  color: "#333",
  outline: "none",
  backgroundColor: "#fff",
  fontFamily: FONT,
  boxSizing: "border-box",
};

export function CreateDeliveryModal({
  open,
  onClose,
  onCreated,
}: CreateDeliveryModalProps) {
  const [vendorId, setVendorId] = useState("");
  const [jobId, setJobId] = useState("");
  const [poNumber, setPoNumber] = useState("");
  const [deliveryDate, setDeliveryDate] = useState("");
  const [stagingLocationId, setStagingLocationId] = useState("");
  const [lineItems, setLineItems] = useState<LineItemRow[]>([
    { ...EMPTY_LINE_ITEM },
  ]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [stagingLocations, setStagingLocations] = useState<StagingLocation[]>(
    [],
  );
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [zoneOccupancy, setZoneOccupancy] = useState<
    Record<string, { orderNumber: string }>
  >({});

  useEffect(() => {
    if (!open) return;
    void Promise.all([
      listVendors(),
      listJobs(),
      firestoreDataService.listStagingLocations(),
      mapOccupancyByLocationId(),
    ]).then(([loadedVendors, loadedJobs, loadedLocations, occupancy]) => {
      setVendors(loadedVendors);
      setJobs(loadedJobs);
      setStagingLocations(loadedLocations);
      setZoneOccupancy(occupancy);
    });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setVendorId("");
    setJobId("");
    setPoNumber("");
    setDeliveryDate("");
    setStagingLocationId("");
    setLineItems([{ ...EMPTY_LINE_ITEM }]);
    setSubmitError(null);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  const validLineItems = useMemo(
    () =>
      lineItems.filter(
        (row) => row.description.trim() !== "" && row.qtyOrdered >= 1,
      ),
    [lineItems],
  );

  const isValid =
    vendorId !== "" &&
    jobId !== "" &&
    deliveryDate !== "" &&
    validLineItems.length >= 1;

  const updateLineItem = (
    index: number,
    field: keyof LineItemRow,
    value: string | number,
  ) => {
    setLineItems((prev) =>
      prev.map((row, i) => (i === index ? { ...row, [field]: value } : row)),
    );
  };

  const addLineItem = () => {
    setLineItems((prev) => [...prev, { ...EMPTY_LINE_ITEM }]);
  };

  const removeLineItem = (index: number) => {
    if (lineItems.length <= 1) return;
    setLineItems((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!isValid) return;
    setSubmitError(null);

    try {
      await createDelivery({
        vendorId,
        jobId,
        poNumber: poNumber.trim() || undefined,
        deliveryDate,
        stagingLocationId: stagingLocationId || undefined,
        lineItems: validLineItems.map((row) => ({
          sku: row.sku.trim() || undefined,
          description: row.description.trim(),
          qtyOrdered: row.qtyOrdered,
        })),
      });

      onCreated();
      onClose();
    } catch (err) {
      if (isStagingLocationOccupiedError(err)) {
        setSubmitError(err.message);
        return;
      }
      throw err;
    }
  };

  if (!open) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 60,
        backgroundColor: "rgba(10,15,30,0.55)",
        backdropFilter: "blur(3px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
        fontFamily: FONT,
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 620,
          maxHeight: "90vh",
          overflowY: "auto",
          backgroundColor: "#fff",
          borderRadius: 8,
          boxShadow: "0 12px 40px rgba(0,0,0,0.22)",
          border: "1px solid #e0e3e8",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            padding: "16px 20px",
            borderBottom: "1px solid #e0e3e8",
            boxShadow: "rgba(0,0,0,0.08) 0px 2px 6px 0px",
          }}
        >
          <h2
            style={{
              margin: 0,
              fontSize: 18,
              fontWeight: 700,
              color: NAVY,
            }}
          >
            New Delivery
          </h2>
          <p style={{ margin: "4px 0 0", fontSize: 12, color: "#9ca3af" }}>
            Create a delivery order with line items
          </p>
        </div>

        <form onSubmit={handleSubmit} style={{ padding: "20px" }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 16,
              marginBottom: 16,
            }}
          >
            <div>
              <label style={labelStyle}>Vendor *</label>
              <select
                value={vendorId}
                onChange={(e) => setVendorId(e.target.value)}
                style={inputStyle}
                required
              >
                <option value="">Select vendor…</option>
                {vendors.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label style={labelStyle}>Job *</label>
              <select
                value={jobId}
                onChange={(e) => setJobId(e.target.value)}
                style={inputStyle}
                required
              >
                <option value="">Select job…</option>
                {jobs.map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.jobNumber} — {j.jobName}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label style={labelStyle}>PO Number</label>
              <input
                type="text"
                value={poNumber}
                onChange={(e) => setPoNumber(e.target.value)}
                placeholder="Optional"
                style={inputStyle}
              />
            </div>

            <div>
              <label style={labelStyle}>Expected Delivery Date *</label>
              <input
                type="date"
                value={deliveryDate}
                onChange={(e) => setDeliveryDate(e.target.value)}
                style={inputStyle}
                required
              />
            </div>

            <div style={{ gridColumn: "1 / -1" }}>
              <label style={labelStyle}>Staging Location</label>
              <select
                value={stagingLocationId}
                onChange={(e) => setStagingLocationId(e.target.value)}
                style={inputStyle}
              >
                <option value="">— Unassigned —</option>
                {stagingLocations
                  .filter(isLocationActive)
                  .map((loc) => {
                    const occupant = zoneOccupancy[loc.id];
                    const inUse = Boolean(occupant);
                    return (
                      <option key={loc.id} value={loc.id} disabled={inUse}>
                        {loc.code} — {loc.label}
                        {inUse ? ` (in use: ${occupant.orderNumber})` : ""}
                      </option>
                    );
                  })}
              </select>
            </div>
          </div>

          <div style={{ marginBottom: 16 }}>
            <label style={{ ...labelStyle, marginBottom: 10 }}>
              Line Items *
            </label>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {lineItems.map((row, index) => (
                <div
                  key={index}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 2fr 80px auto",
                    gap: 8,
                    alignItems: "end",
                    padding: 12,
                    backgroundColor: "#f9fafb",
                    borderRadius: 6,
                    border: "1px solid #e5e7eb",
                  }}
                >
                  <div>
                    {index === 0 && (
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 600,
                          color: "#9ca3af",
                          display: "block",
                          marginBottom: 4,
                        }}
                      >
                        SKU
                      </span>
                    )}
                    <input
                      type="text"
                      value={row.sku}
                      onChange={(e) =>
                        updateLineItem(index, "sku", e.target.value)
                      }
                      placeholder="Optional"
                      style={{ ...inputStyle, padding: "8px 10px" }}
                    />
                  </div>
                  <div>
                    {index === 0 && (
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 600,
                          color: "#9ca3af",
                          display: "block",
                          marginBottom: 4,
                        }}
                      >
                        Description *
                      </span>
                    )}
                    <input
                      type="text"
                      value={row.description}
                      onChange={(e) =>
                        updateLineItem(index, "description", e.target.value)
                      }
                      placeholder="Item description"
                      style={{ ...inputStyle, padding: "8px 10px" }}
                    />
                  </div>
                  <div>
                    {index === 0 && (
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 600,
                          color: "#9ca3af",
                          display: "block",
                          marginBottom: 4,
                        }}
                      >
                        Qty *
                      </span>
                    )}
                    <input
                      type="number"
                      min={1}
                      value={row.qtyOrdered}
                      onChange={(e) =>
                        updateLineItem(
                          index,
                          "qtyOrdered",
                          Math.max(1, parseInt(e.target.value, 10) || 1),
                        )
                      }
                      style={{ ...inputStyle, padding: "8px 10px" }}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => removeLineItem(index)}
                    disabled={lineItems.length <= 1}
                    style={{
                      padding: "8px 10px",
                      border: "1px solid #ccd0d7",
                      borderRadius: 4,
                      backgroundColor:
                        lineItems.length <= 1 ? "#f3f4f6" : "#fff",
                      color: lineItems.length <= 1 ? "#9ca3af" : RED,
                      fontWeight: 700,
                      fontSize: 12,
                      cursor: lineItems.length <= 1 ? "not-allowed" : "pointer",
                      fontFamily: FONT,
                      whiteSpace: "nowrap",
                    }}
                  >
                    ✕ Remove
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={addLineItem}
              style={{
                marginTop: 10,
                padding: "6px 12px",
                border: `1.5px solid ${NAVY}`,
                borderRadius: 4,
                backgroundColor: "#fff",
                color: NAVY,
                fontWeight: 700,
                fontSize: 12,
                cursor: "pointer",
                fontFamily: FONT,
              }}
            >
              + Add Item
            </button>
          </div>

          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              gap: 10,
              paddingTop: 8,
              borderTop: "1px solid #e0e3e8",
            }}
          >
            {submitError && (
              <p
                style={{
                  margin: "0 0 12px",
                  fontSize: 13,
                  color: RED,
                  fontFamily: FONT,
                }}
              >
                {submitError}
              </p>
            )}
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: "8px 16px",
                border: "1px solid #ccd0d7",
                borderRadius: 4,
                backgroundColor: "#fff",
                color: "#333",
                fontWeight: 700,
                fontSize: 13,
                cursor: "pointer",
                fontFamily: FONT,
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!isValid}
              style={{
                padding: "8px 16px",
                border: "none",
                borderRadius: 4,
                backgroundColor: isValid ? NAVY : "#d1d5db",
                color: "#fff",
                fontWeight: 700,
                fontSize: 13,
                cursor: isValid ? "pointer" : "not-allowed",
                fontFamily: FONT,
              }}
            >
              Create Delivery
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
