import type { DeliveryDetails, IssueResolutionType, MaterialIssue } from "../models";
import {
  ISSUE_RESOLUTION_TYPE_LABEL,
  ISSUE_RESOLUTION_TYPES,
} from "../models";
import {
  DRAWER_MODAL_INPUT_STYLE,
} from "./resolveIssueDefaults";

function isValidEmail(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= 254 && trimmed.includes("@");
}

export function ResolveIssueModal({
  issueId,
  details,
  resolutionType,
  resolutionNote,
  emailTo,
  emailCc,
  emailSubject,
  emailBody,
  saveVendorEmail,
  mutationLoading,
  emailProviderConnected,
  emailVendorLoading,
  emailVendorError,
  emailVendorSuccess,
  navy,
  font,
  onResolutionTypeChange,
  onResolutionNoteChange,
  onEmailToChange,
  onEmailCcChange,
  onEmailSubjectChange,
  onEmailBodyChange,
  onSaveVendorEmailChange,
  onEmailVendor,
  onClose,
  onSubmit,
}: {
  issueId: string;
  details: DeliveryDetails;
  resolutionType: IssueResolutionType;
  resolutionNote: string;
  emailTo: string;
  emailCc: string;
  emailSubject: string;
  emailBody: string;
  saveVendorEmail: boolean;
  mutationLoading: boolean;
  emailProviderConnected: boolean;
  emailVendorLoading: boolean;
  emailVendorError: string | null;
  emailVendorSuccess: boolean;
  navy: string;
  font: string;
  onResolutionTypeChange: (type: IssueResolutionType, issue: MaterialIssue) => void;
  onResolutionNoteChange: (note: string, touched: boolean) => void;
  onEmailToChange: (value: string) => void;
  onEmailCcChange: (value: string) => void;
  onEmailSubjectChange: (value: string) => void;
  onEmailBodyChange: (value: string) => void;
  onSaveVendorEmailChange: (checked: boolean) => void;
  onEmailVendor: () => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  const issue = details.materialIssues.find((i) => i.id === issueId);
  const { vendor } = details;
  const vendorPhone = vendor.contactPhone?.trim() ?? "";
  const vendorEmailOnFile = vendor.email?.trim() ?? "";
  const vendorAddress = vendor.address?.trim() ?? "";
  const showNeedMoreInfo = resolutionType === "need_more_information";
  const toNormalized = emailTo.trim().toLowerCase();
  const vendorEmailNormalized = vendorEmailOnFile.toLowerCase();
  const toDiffersFromOnFile =
    !!toNormalized &&
    !!vendorEmailNormalized &&
    toNormalized !== vendorEmailNormalized;
  const needsSaveCheckbox =
    isValidEmail(emailTo) &&
    (toDiffersFromOnFile || !vendorEmailOnFile);
  const canSendEmail =
    emailProviderConnected &&
    isValidEmail(emailTo) &&
    !!emailSubject.trim() &&
    !!emailBody.trim() &&
    !emailVendorLoading &&
    (!needsSaveCheckbox || saveVendorEmail);
  const canSaveResolution =
    !mutationLoading &&
    (resolutionType !== "other" || !!resolutionNote.trim());

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
        className="admin-card"
        style={{
          width: "100%",
          maxWidth: 580,
          maxHeight: "90vh",
          overflowY: "auto",
          backgroundColor: "var(--admin-surface)",
          borderRadius: "var(--admin-radius-lg)",
          padding: "24px 28px",
          boxShadow: "var(--admin-shadow-card)",
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
          className="admin-control"
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
            borderRadius: "var(--admin-control-radius)",
            border: "1px solid var(--admin-border)",
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

        {!showNeedMoreInfo && (
          <>
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
              Resolution note
              {resolutionType === "other" ? " (required)" : " (optional)"}
            </label>
            <p
              style={{
                margin: "0 0 8px",
                fontSize: 12,
                color: "var(--admin-text-muted)",
                fontFamily: font,
              }}
            >
              Suggested text below — edit before save. This is what technicians and
              dispatch will see on the resolved issue.
            </p>
            <textarea
              className="admin-control"
              id="resolution-note-input"
              data-testid="resolution-note-input"
              value={resolutionNote}
              onChange={(e) => onResolutionNoteChange(e.target.value, true)}
              rows={8}
              placeholder="What happened and next steps for the technician"
              style={{
                width: "100%",
                marginBottom: 16,
                padding: "12px 14px",
                borderRadius: "var(--admin-control-radius)",
                border: "1px solid var(--admin-border)",
                fontSize: 14,
                lineHeight: 1.5,
                fontFamily: font,
                resize: "vertical",
                ...DRAWER_MODAL_INPUT_STYLE,
              }}
            />
          </>
        )}

        {showNeedMoreInfo && (
          <section
            data-testid="resolve-need-more-info-section"
            className="admin-card"
            style={{
              marginBottom: 20,
              padding: "16px 18px",
              borderRadius: "var(--admin-radius-md)",
              border: "1px solid #e2e8f0",
              backgroundColor: "var(--admin-surface-2)",
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
                    <span style={{ color: "var(--admin-text-muted)" }}>No phone on file</span>
                  )}
                </dd>
              </div>
              <div style={{ marginBottom: 8 }}>
                <dt style={{ fontWeight: 700, marginBottom: 2 }}>Email on file</dt>
                <dd style={{ margin: 0 }} data-testid="resolve-vendor-email">
                  {vendorEmailOnFile || (
                    <span style={{ color: "var(--admin-text-muted)" }}>No email on file</span>
                  )}
                </dd>
              </div>
              <div>
                <dt style={{ fontWeight: 700, marginBottom: 2 }}>Address</dt>
                <dd style={{ margin: 0 }} data-testid="resolve-vendor-address">
                  {vendorAddress || (
                    <span style={{ color: "var(--admin-text-muted)" }}>No address on file</span>
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
              Email to vendor
            </h4>
            <label
              htmlFor="resolve-email-to"
              style={{
                display: "block",
                fontSize: 12,
                fontWeight: 600,
                marginBottom: 6,
                fontFamily: font,
              }}
            >
              To
            </label>
            <input
              className="admin-control"
              id="resolve-email-to"
              data-testid="resolve-email-to"
              type="email"
              value={emailTo}
              onChange={(e) => onEmailToChange(e.target.value)}
              placeholder="vendor@example.com"
              style={{
                width: "100%",
                marginBottom: 12,
                padding: "10px 12px",
                borderRadius: "var(--admin-control-radius)",
                border: "1px solid var(--admin-border)",
                fontSize: 14,
                fontFamily: font,
                ...DRAWER_MODAL_INPUT_STYLE,
              }}
            />
            <label
              htmlFor="resolve-email-cc"
              style={{
                display: "block",
                fontSize: 12,
                fontWeight: 600,
                marginBottom: 6,
                fontFamily: font,
              }}
            >
              Additional email addresses (optional)
            </label>
            <input
              className="admin-control"
              id="resolve-email-cc"
              data-testid="resolve-email-cc"
              type="text"
              value={emailCc}
              onChange={(e) => onEmailCcChange(e.target.value)}
              placeholder="sales@vendor.com, branch@vendor.com"
              style={{
                width: "100%",
                marginBottom: 6,
                padding: "10px 12px",
                borderRadius: "var(--admin-control-radius)",
                border: "1px solid var(--admin-border)",
                fontSize: 14,
                fontFamily: font,
                ...DRAWER_MODAL_INPUT_STYLE,
              }}
            />
            <p
              data-testid="resolve-email-cc-hint"
              style={{
                margin: "0 0 12px",
                fontSize: 11,
                color: "var(--admin-text-muted)",
                fontFamily: font,
              }}
            >
              Comma-separated Cc recipients (max 5).
            </p>
            {toDiffersFromOnFile && (
              <p
                data-testid="resolve-email-to-warning"
                style={{
                  margin: "0 0 10px",
                  fontSize: 12,
                  color: "var(--admin-warning-text)",
                  fontFamily: font,
                }}
              >
                This address differs from the email on file for this vendor.
              </p>
            )}
            {needsSaveCheckbox && (
              <label
                data-testid="resolve-save-vendor-email-label"
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 8,
                  marginBottom: 14,
                  fontSize: 12,
                  fontFamily: font,
                  cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  data-testid="resolve-save-vendor-email"
                  checked={saveVendorEmail}
                  onChange={(e) => onSaveVendorEmailChange(e.target.checked)}
                  style={{ marginTop: 2 }}
                />
                <span>Save this email to vendor record for future use</span>
              </label>
            )}
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
              className="admin-control"
              id="resolve-email-subject"
              data-testid="resolve-email-subject"
              value={emailSubject}
              onChange={(e) => onEmailSubjectChange(e.target.value)}
              style={{
                width: "100%",
                marginBottom: 12,
                padding: "10px 12px",
                borderRadius: "var(--admin-control-radius)",
                border: "1px solid var(--admin-border)",
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
              className="admin-control"
              id="resolve-email-message"
              data-testid="resolve-email-message"
              rows={emailBody ? 10 : 4}
              value={emailBody}
              onChange={(e) => onEmailBodyChange(e.target.value)}
              placeholder="Email message to vendor"
              style={{
                width: "100%",
                marginBottom: 14,
                padding: "12px 14px",
                borderRadius: "var(--admin-control-radius)",
                border: "1px solid var(--admin-border)",
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
                className="admin-btn admin-btn-primary"
                data-testid="resolve-email-vendor"
                disabled={!canSendEmail}
                onClick={onEmailVendor}
                title={
                  emailProviderConnected
                    ? canSendEmail
                      ? "Send email to vendor via Gmail"
                      : "Complete email fields and confirm save if address changed"
                    : "Email provider not connected yet."
                }
                style={{
                  alignSelf: "flex-start",
                  padding: "9px 16px",
                  borderRadius: "var(--admin-control-radius)",
                  border: "none",
                  backgroundColor: canSendEmail ? navy : "var(--admin-border)",
                  color: canSendEmail ? "var(--admin-on-navy)" : "var(--admin-text-muted)",
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
                    color: "var(--admin-text-muted)",
                    fontFamily: font,
                  }}
                >
                  Email provider not connected yet.
                </p>
              )}
              {emailVendorError && (
                <p
                  data-testid="resolve-email-vendor-error"
                  style={{
                    margin: 0,
                    fontSize: 12,
                    color: "var(--admin-danger-text)",
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
                    color: "var(--admin-success-text)",
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
            className="admin-btn"
            onClick={onClose}
            style={{
              padding: "9px 16px",
              borderRadius: "var(--admin-control-radius)",
              border: "1px solid var(--admin-border)",
              backgroundColor: "var(--admin-surface)",
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
            className="admin-btn admin-btn-primary"
            data-testid="confirm-resolve-issue"
            disabled={!canSaveResolution}
            onClick={onSubmit}
            style={{
              padding: "9px 16px",
              borderRadius: "var(--admin-control-radius)",
              border: "none",
              backgroundColor: canSaveResolution ? navy : "var(--admin-border)",
              color: canSaveResolution ? "var(--admin-on-navy)" : "var(--admin-text-muted)",
              fontSize: 14,
              fontWeight: 700,
              cursor: canSaveResolution ? "pointer" : "not-allowed",
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
