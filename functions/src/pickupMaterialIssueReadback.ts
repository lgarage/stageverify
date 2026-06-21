/** Public-safe material issue snapshot on delivery — pickup portal readback only. */

export interface PickupMaterialIssueReadback {
  id: string;
  type: string;
  status: string;
  blocking: boolean;
  description?: string;
  resolutionType?: string;
  resolutionNote?: string;
  resolvedAt?: string;
}

export function appendPickupMaterialIssueReadback(
  existing: PickupMaterialIssueReadback[] | undefined,
  entry: PickupMaterialIssueReadback,
): PickupMaterialIssueReadback[] {
  return [...(existing ?? []), entry];
}

export function resolvePickupMaterialIssueReadback(
  existing: PickupMaterialIssueReadback[] | undefined,
  issueId: string,
  resolution: {
    resolutionType: string;
    resolutionNote: string;
    resolvedAt: string;
  },
): PickupMaterialIssueReadback[] {
  return (existing ?? []).map((row) =>
    row.id === issueId
      ? {
          ...row,
          status: "resolved",
          resolutionType: resolution.resolutionType,
          resolutionNote: resolution.resolutionNote,
          resolvedAt: resolution.resolvedAt,
        }
      : row,
  );
}
