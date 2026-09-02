import type { CSSProperties, ImgHTMLAttributes } from "react";

type BrandVariant = "icon" | "wordmark";

const BRAND_ASSET_FILES: Record<BrandVariant, string> = {
  icon: "logos/stageverify-app-icon.svg",
  wordmark: "logos/stageverify-logo-main.svg",
};

interface StageVerifyBrandMarkProps
  extends Omit<
    ImgHTMLAttributes<HTMLImageElement>,
    "alt" | "height" | "src" | "style"
  > {
  variant?: BrandVariant;
  height?: number;
  style?: CSSProperties;
}

export function StageVerifyBrandMark({
  variant = "icon",
  height,
  style,
  ...imageProps
}: StageVerifyBrandMarkProps) {
  const fixedHeight = height ?? (variant === "icon" ? 56 : 44);
  const src = `${import.meta.env.BASE_URL}${BRAND_ASSET_FILES[variant]}`;

  return (
    <img
      {...imageProps}
      src={src}
      alt="StageVerify"
      height={fixedHeight}
      style={{
        ...style,
        display: "block",
        width: "auto",
        maxWidth: "100%",
        height: fixedHeight,
        objectFit: "contain",
      }}
    />
  );
}
