import type { CSSProperties, ImgHTMLAttributes } from "react";
import {
  stageVerifyBrandAssetPath,
  type StageVerifyBrandVariant,
} from "./stageVerifyBrandAssets";

interface StageVerifyBrandMarkProps
  extends Omit<
    ImgHTMLAttributes<HTMLImageElement>,
    "alt" | "height" | "src" | "style"
  > {
  variant?: StageVerifyBrandVariant;
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

  return (
    <img
      {...imageProps}
      src={stageVerifyBrandAssetPath(variant)}
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
