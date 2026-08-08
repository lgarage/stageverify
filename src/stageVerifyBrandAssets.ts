export const STAGEVERIFY_BRAND_COLORS = {
  sky: "#558cb4",
  blue: "#3689c6",
  slate: "#53718c",
  navy: "#204368",
} as const;

export type StageVerifyBrandVariant = "icon" | "wordmark";

const BRAND_ASSET_FILES: Record<StageVerifyBrandVariant, string> = {
  icon: "logos/stageverify-app-icon.svg",
  wordmark: "logos/stageverify-logo-main.svg",
};

export function stageVerifyBrandAssetPath(
  variant: StageVerifyBrandVariant,
): string {
  return `${import.meta.env.BASE_URL}${BRAND_ASSET_FILES[variant]}`;
}
