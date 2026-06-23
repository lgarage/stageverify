import type { DeliveryDetails, IssueResolutionType, MaterialIssue } from "../models";
import {
  ISSUE_RESOLUTION_TYPE_LABEL,
  ISSUE_RESOLUTION_TYPES,
} from "../models";
import {
  buildNeedMoreInfoEmailBody,
  buildNeedMoreInfoEmailSubject,
} from "./needMoreInfoDraft";
import {
  DRAWER_MODAL_INPUT_STYLE,
} from "./resolveIssueDefaults";

export function ResolveIssueModal({
  issueId,
  details,
  resolutionType,
  resolutionNote,
  mutationLoading,
  emailProviderConnected,
  emailVendorLoading,
  emailVendorError,
  emailVendorSuccess,
  navy,
  font,
  onResolutionTypeChange,
  onResolutionNoteChange,
  onEmailVendor,
  onClose,
  onSubmit,
}: {
  issueId: string;
  details: DeliveryDetails;
  resolutionType: IssueResolutionType;
  resolutionNote: string;
  mutationLoading: boolean;
  emailProviderConnected: boolean;
  emailVendorLoading: boolean;
  emailVendorError: string | null;
  emailVendorSuccess: boolean;
  navy: string;
  font: string;
  onResolutionTypeChange: (type: IssueResolutionType, issue: MaterialIssue) => void;
  onResolutionNoteChange: (note: string, touched: boolean) => void;
  onEmailVendor: () => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  const issue = details.materialIssues.find((i) => i.id === issueId);
  const { vendor } = details;
  const vendorPhone = vendor.contactPhone?.trim() ?? "";
  const vendorEmail = vendor.email?.trim() ?? "";
  const vendorAddress = vendor.address?.trim() ?? "";
  const showNeedMoreInfo = resolutionType === "need_more_information";
  const emailSubject = buildNeedMoreInfoEmailSubject(details);
  const emailBody = buildNeedMoreInfoEmailBody(details) ?? "";
  const canSendEmail =
    emailProviderConnected &&
    !!vendorEmail &&
    !!emailBody &&
    !emailVendorLoading;

  return (
    <div
      data-testid="resolve-issue-modal"
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(0,0,0,0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 60,
        padding: 16,
      }}
      onClick={onClose}
    >
      <div
        data-testid="resolve-issue-modal-panel"
        style={{
          width: "100%",
          maxWidth: 580,
          maxHeight: "90vh",
          overflowY: "auto",
          backgroundColor: "#fff",
          borderRadius: 12,
          padding: "24px 28px",
          boxShadow: "0 12px 40px rgba(0,0,0,0.2)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3
          style={{
            margin: "0 0 16px",
            fontSize: 18,
            fontWeight: 700,
            color: navy,
            fontFamily: font,
          }}
        >
          Resolve material issue
        </h3>
        <label
          htmlFor="resolution-type-select"
          style={{
            display: "block",
            fontSize: 13,
            fontWeight: 600,
            marginBottom: 8,
            fontFamily: font,
          }}
        >
          Resolution type
        </label>
        <select
          id="resolution-type-select"
          data-testid="resolution-type-select"
          value={resolutionType}
          onChange={(e) => {
            const nextType = e.target.value as IssueResolutionType;
            if (issue) {
              onResolutionTypeChange(nextType, issue);
            }
          }}
          style={{
            width: "100%",
            marginBottom: 16,
            padding: "10px 12px",
            borderRadius: 6,
            border: "1px solid #d1d5db",
            fontSize: 14,
            fontFamily: font,
            ...DRAWER_MODAL_INPUT_STYLE,
          }}
        >
          {ISSUE_RESOLUTION_TYPES.map((type) => (
            <option key={type} value={type}>
              {ISSUE_RESOLUTION_TYPE_LABEL[type]}
            </option>
          ))}
        </select>
        <label
          htmlFor="resolution-note-input"
          style={{
            display: "block",
            fontSize: 13,
            fontWeight: 600,
            marginBottom: 8,
            fontFamily: font,
          }}
        >
          Resolution note (saved on issue record)
        </label>
        <p
          style={{
            margin: "0 0 8px",
            fontSize: 12,
            color: "#64748b",
            fontFamily: font,
          }}
        >
          Suggested text below — edit before save. This is what technicians and
          dispatch will see on the resolved issue.
        </p>
        <textarea
          id="resolution-note-input"
          data-testid="resolution-note-input"
          value={resolutionNote}
          onChange={(e) => onResolutionNoteChange(e.target.value, true)}
          rows={8}
          placeholder="What happened and next steps for the technician"
          style={{
            width: "100%",
            marginBottom: showNeedMoreInfo ? 20 : 16,
            padding: "12px 14px",
            borderRadius: 6,
            border: "1px solid #d1d5db",
            fontSize: 14,
            lineHeight: 1.5,
            fontFamily: font,
            resize: "vertical",
            ...DRAWER_MODAL_INPUT_STYLE,
          }}
        />

        {showNeedMoreInfo && (
          <section
            data-testid="resolve-need-more-info-section"
            style={{
              marginBottom: 20,
              padding: "16px 18px",
              borderRadius: 8,
              border: "1px solid #e2e8f0",
              backgroundColor: "#f8fafc",
            }}
          >
            <h4
              style={{
                margin: "0 0 12px",
                fontSize: 14,
                fontWeight: 700,
                color: navy,
                fontFamily: font,
              }}
            >
              Vendor Information
            </h4>
            <dl
              data-testid="resolve-vendor-info"
              style={{
                margin: "0 0 16px",
                fontSize: 13,
                color: "#111827",
                fontFamily: font,
              }}
            >
              <div style={{ marginBottom: 8 }}>
                <dt style={{ fontWeight: 700, marginBottom: 2 }}>Vendor</dt>
                <dd style={{ margin: 0 }} data-testid="resolve-vendor-name">
                  {vendor.name}
                  {vendor.contactName ? ` (${vendor.contactName})` : ""}
                </dd>
              </div>
              <div style={{ marginBottom: 8 }}>
                <dt style={{ fontWeight: 700, marginBottom: 2 }}>Phone</dt>
                <dd style={{ margin: 0 }} data-testid="resolve-vendor-phone">
                  {vendorPhone || (
                    <span style={{ color: "#64748b" }}>No phone on file</span>
                  )}
                </dd>
              </div>
              <div style={{ marginBottom: 8 }}>
                <dt style={{ fontWeight: 700, marginBottom: 2 }}>Email</dt>
                <dd style={{ margin: 0 }} data-testid="resolve-vendor-email">
                  {vendorEmail || (
                    <span style={{ color: "#64748b" }}>No email on file</span>
                  )}
                </dd>
              </div>
              <div>
                <dt style={{ fontWeight: 700, marginBottom: 2 }}>Address</dt>
                <dd style={{ margin: 0 }} data-testid="resolve-vendor-address">
                  {vendorAddress || (
                    <span style={{ color: "#64748b" }}>No address on file</span>
                  )}
                </dd>
              </div>
            </dl>

            <h4
              style={{
                margin: "0 0 10px",
                fontSize: 14,
                fontWeight: 700,
                color: navy,
                fontFamily: font,
              }}
            >
              Email Preview
            </h4>
            <label
              htmlFor="resolve-email-subject"
              style={{
                display: "block",
                fontSize: 12,
                fontWeight: 600,
                marginBottom: 6,
                fontFamily: font,
              }}
            >
              Subject
            </label>
            <input
              id="resolve-email-subject"
              data-testid="resolve-email-subject"
              readOnly
              value={emailSubject}
              style={{
                width: "100%",
                marginBottom: 12,
                padding: "10px 12px",
                borderRadius: 6,
                border: "1px solid #d1d5db",
                fontSize: 14,
                fontFamily: font,
                ...DRAWER_MODAL_INPUT_STYLE,
              }}
            />
            <label
              htmlFor="resolve-email-message"
              style={{
                display: "block",
                fontSize: 12,
                fontWeight: 600,
                marginBottom: 6,
                fontFamily: font,
              }}
            >
              Message
            </label>
            <textarea
              id="resolve-email-message"
              data-testid="resolve-email-message"
              readOnly
              rows={emailBody ? 10 : 4}
              value={
                emailBody ||
                "Email preview unavailable — no open issues or missing items to include."
              }
              style={{
                width: "100%",
                marginBottom: 14,
                padding: "12px 14px",
                borderRadius: 6,
                border: "1px solid #d1d5db",
                fontSize: 14,
                lineHeight: 1.5,
                fontFamily: font,
                resize: "vertical",
                ...DRAWER_MODAL_INPUT_STYLE,
              }}
            />
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <button
                type="button"
                data-testid="resolve-email-vendor"
                disabled={!canSendEmail}
                onClick={onEmailVendor}
                title={
                  emailProviderConnected
                    ? vendorEmail && emailBody
                      ? "Send email to vendor via Gmail"
                      : "Vendor email or message preview required"
                    : "Email provider not connected yet."
                }
                style={{
                  alignSelf: "flex-start",
                  padding: "9px 16px",
                  borderRadius: 6,
                  border: "none",
                  backgroundColor: canSendEmail ? navy : "#e5e7eb",
                  color: canSendEmail ? "#fff" : "#9ca3af",
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: canSendEmail ? "pointer" : "not-allowed",
                  fontFamily: font,
                  opacity: emailVendorLoading ? 0.7 : 1,
                }}
              >
                {emailVendorLoading ? "Sending…" : "Email Vendor"}
              </button>
              {!emailProviderConnected && (
                <p
                  data-testid="resolve-email-provider-disconnected"
                  style={{
                    margin: 0,
                    fontSize: 12,
                    color: "#64748b",
                    fontFamily: font,
                  }}
                >
                  Email provider not connected yet.
                </p>
              )}
              {emailProviderConnected && !vendorEmail && (
                <p
                  data-testid="resolve-email-no-vendor-email"
                  style={{
                    margin: 0,
                    fontSize: 12,
                    color: "#64748b",
                    fontFamily: font,
                  }}
                >
                  Add vendor email on the Vendors page to send.
                </p>
              )}
              {emailVendorError && (
                <p
                  data-testid="resolve-email-vendor-error"
                  style={{
                    margin: 0,
                    fontSize: 12,
                    color: "#b91c1c",
                    fontFamily: font,
                  }}
                >
                  {emailVendorError}
                </p>
              )}
              {emailVendorSuccess && (
                <p
                  data-testid="resolve-email-vendor-success"
                  style={{
                    margin: 0,
                    fontSize: 12,
                    color: "#15803d",
                    fontFamily: font,
                  }}
                >
                  Email sent — see Vendor Communications in the drawer.
                </p>
              )}
            </div>
          </section>
        )}

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: "9px 16px",
              borderRadius: 6,
              border: "1px solid #d1d5db",
              backgroundColor: "#fff",
              fontSize: 14,
              fontWeight: 600,
              cursor: "pointer",
              fontFamily: font,
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            data-testid="confirm-resolve-issue"
            disabled={mutationLoading || !resolutionNote.trim()}
            onClick={onSubmit}
            style={{
              padding: "9px 16px",
              borderRadius: 6,
              border: "none",
              backgroundColor: navy,
              color: "#fff",
              fontSize: 14,
              fontWeight: 700,
              cursor: mutationLoading ? "not-allowed" : "pointer",
              opacity: mutationLoading ? 0.6 : 1,
              fontFamily: font,
            }}
          >
            Save resolution
          </button>
        </div>
      </div>
    </div>
  );
}
