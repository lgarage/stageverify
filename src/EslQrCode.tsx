import { QRCodeSVG } from "qrcode.react";
import {
  ESL_QR_RENDER_PROPS,
  ESL_QR_SIZE_PREVIEW,
  ESL_QR_SIZE_PRINT,
} from "./receiveQrUrls";

type EslQrCodeProps = {
  value: string;
  variant?: "preview" | "print";
  /** Override pixel size (e.g. letter location signs). */
  size?: number;
};

/** Shared QR render for zone e-tag previews and dispatcher print labels. */
export function EslQrCode({
  value,
  variant = "preview",
  size: sizeOverride,
}: EslQrCodeProps) {
  const size =
    sizeOverride ??
    (variant === "print" ? ESL_QR_SIZE_PRINT : ESL_QR_SIZE_PREVIEW);
  return <QRCodeSVG value={value} size={size} {...ESL_QR_RENDER_PROPS} />;
}
