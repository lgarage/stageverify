import { useState } from "react";
import {
  type DeliveryDetails,
  type MaterialIssueType,
} from "./dispatcher/models";
import { reportMaterialIssue } from "./dispatcher/firestoreService";

type VendorIssueChoice =
  | "wrong_location"
  | "damaged"
  | "missing"
  | "other";

const ISSUE_OPTIONS: { id: VendorIssueChoice; label: string }[] = [
  { id: "wrong_location", label: "Wrong Location" },
  { id: "damaged", label: "Damaged Items" },
  { id: "missing", label: "Missing Items" },
  { id: "other", label: "Other" },
];

function mapIssueType(choice: VendorIssueChoice): MaterialIssueType {
  if (choice === "wrong_location") return "other";
  return choice;
}

function buildDescription(
  choice: VendorIssueChoice,
  note: string,
): string | undefined {
  const trimmed = note.trim();
  if (choice === "wrong_location") {
    return trimmed
      ? `Wrong location: ${trimmed}`
      : "Wrong location";
  }
  return trimmed || undefined;
}

interface VendorIssueModalProps {
  deliveryDetails: DeliveryDetails;
  onClose: () => void;
  onSubmitted: () => void;
}

export function VendorIssueModal({
  deliveryDetails,
  onClose,
  onSubmitted,
}: VendorIssueModalProps) {
  const [choice, setChoice] = useState<VendorIssueChoice>("wrong_location");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await reportMaterialIssue({
        deliveryOrderId: deliveryDetails.delivery.id,
        jobId: deliveryDetails.delivery.jobId,
        type: mapIssueType(choice),
        description: buildDescription(choice, note),
        reportedBy: "Vendor Driver",
        clientRequestId: crypto.randomUUID(),
      });
      onSubmitted();
      onClose();
    } catch {
      setError("Could not submit issue. Try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col justify-end bg-black/60"
      onClick={onClose}
    >
      <div
        className="rounded-t-2xl border-t border-border bg-bg-primary px-4 pt-5 pb-[calc(env(safe-area-inset-bottom,16px)+20px)]"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-bold text-text-primary">
          What&apos;s the issue?
        </h2>
        <p className="text-sm text-text-secondary mt-1 mb-5">
          {deliveryDetails.delivery.orderNumber} · {deliveryDetails.vendor.name}
        </p>

        <div className="space-y-2.5 mb-4">
          {ISSUE_OPTIONS.map((opt) => {
            const selected = choice === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => setChoice(opt.id)}
                className={`w-full flex items-center gap-3 rounded-xl border px-3 py-3.5 text-left transition-colors ${
                  selected
                    ? "border-accent bg-accent/10"
                    : "border-border bg-bg-surface"
                }`}
              >
                <span
                  className={`size-5 shrink-0 rounded-full border-2 flex items-center justify-center ${
                    selected ? "border-accent" : "border-text-secondary/50"
                  }`}
                >
                  {selected && (
                    <span className="size-2.5 rounded-full bg-accent" />
                  )}
                </span>
                <span className="text-[15px] font-medium text-text-primary">
                  {opt.label}
                </span>
              </button>
            );
          })}
        </div>

        <label className="block text-sm text-text-secondary mb-2">
          Note (optional)
        </label>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Add details…"
          rows={3}
          className="w-full rounded-xl border border-border bg-bg-secondary px-3 py-3 text-sm text-text-primary resize-none focus:outline-none focus:border-accent"
        />

        {error && (
          <p className="text-sm text-accent-red mt-3" role="alert">
            {error}
          </p>
        )}

        <div className="grid grid-cols-2 gap-2.5 mt-5">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded-xl bg-bg-secondary py-3.5 text-[15px] font-semibold text-text-secondary hover:bg-bg-surface transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={submitting}
            className="rounded-xl bg-accent-amber py-3.5 text-[15px] font-semibold text-bg-primary hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {submitting ? "Submitting…" : "Submit"}
          </button>
        </div>
      </div>
    </div>
  );
}
