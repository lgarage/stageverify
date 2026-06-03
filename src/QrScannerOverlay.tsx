import { useEffect, useRef, useState, type ReactNode } from "react";
import { buildMobileScanConfig, isIosDevice } from "./qrScannerConfig";
import type { Html5QrcodeInstance } from "./qrScannerTypes";
import {
  formatQrScanPreviewDetail,
  formatQrScanPreviewLabel,
} from "./qrScanPreview";

const IOS_YELLOW = "#FFD60A";
const IOS_YELLOW_TEXT = "#1c1c1e";

export type QrScannerOverlayProps = {
  readerId: string;
  onDecode: (text: string) => void;
  onCancel?: () => void;
  onCameraError?: () => void;
  /** fullscreen = centered card (pickup/hub); fill = parent sizes the viewport */
  layout?: "fullscreen" | "fill";
  /** Small mono label above viewfinder (e.g. Pickup Portal) */
  title?: string;
  heading?: string;
  subtitle?: string;
  footer?: ReactNode;
};

function CompassIcon() {
  return (
    <svg
      width={18}
      height={18}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
    >
      <circle cx={12} cy={12} r={9} stroke={IOS_YELLOW_TEXT} strokeWidth={1.5} />
      <path
        d="M12 8v8M8 12h8"
        stroke={IOS_YELLOW_TEXT}
        strokeWidth={1.5}
        strokeLinecap="round"
      />
      <path
        d="M12 4l1.2 3.6L16 8.8l-3.6 1.2L12 14l-1.2-3.6L8 8.8l3.6-1.2L12 4z"
        fill={IOS_YELLOW_TEXT}
        opacity={0.35}
      />
    </svg>
  );
}

function ScanPreviewPill({
  label,
  detail,
  layout,
  onOpen,
  onDismiss,
}: {
  label: string;
  detail: string | null;
  layout: "fullscreen" | "fill";
  onOpen: () => void;
  onDismiss: () => void;
}) {
  const positionClass =
    layout === "fill"
      ? "bottom-6"
      : "top-[calc(50%+148px)]";

  return (
    <div
      className={`absolute left-0 right-0 flex justify-center px-4 z-30 pointer-events-none ${positionClass}`}
    >
      <div
        className="pointer-events-auto flex items-center gap-2 max-w-full rounded-full shadow-lg"
        style={{
          backgroundColor: IOS_YELLOW,
          color: IOS_YELLOW_TEXT,
          padding: "10px 12px 10px 14px",
        }}
      >
        <button
          type="button"
          onClick={onOpen}
          className="flex items-center gap-2 min-w-0 border-none bg-transparent p-0 cursor-pointer text-left"
          style={{ color: IOS_YELLOW_TEXT }}
        >
          <CompassIcon />
          <span className="min-w-0">
            <span className="block font-semibold text-[15px] leading-tight truncate">
              {label}
            </span>
            {detail && (
              <span className="block text-[11px] opacity-80 truncate max-w-[200px]">
                {detail}
              </span>
            )}
          </span>
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDismiss();
          }}
          aria-label="Dismiss"
          className="shrink-0 flex items-center justify-center w-7 h-7 rounded-full border-none cursor-pointer"
          style={{ backgroundColor: "rgba(0,0,0,0.12)", color: IOS_YELLOW_TEXT }}
        >
          <span className="text-lg leading-none font-medium">×</span>
        </button>
      </div>
    </div>
  );
}

export function QrScannerOverlay({
  readerId,
  onDecode,
  onCancel,
  onCameraError,
  layout = "fullscreen",
  title,
  heading,
  subtitle,
  footer,
}: QrScannerOverlayProps) {
  const [preview, setPreview] = useState<{
    raw: string;
    label: string;
    detail: string | null;
  } | null>(null);
  const previewRef = useRef(preview);
  previewRef.current = preview;
  const html5QrCodeRef = useRef<Html5QrcodeInstance | null>(null);
  const confirmingRef = useRef(false);

  const stopScanner = () => {
    const scanner = html5QrCodeRef.current;
    html5QrCodeRef.current = null;
    if (!scanner) return;
    try {
      void scanner
        .stop()
        .then(() => scanner.clear())
        .catch(() => {});
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    let isMounted = true;

    import("html5-qrcode").then(({ Html5Qrcode, Html5QrcodeSupportedFormats }) => {
      if (!isMounted || confirmingRef.current) return;
      const scanner = new Html5Qrcode(readerId, {
        formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE],
        useBarCodeDetectorIfSupported: true,
        verbose: false,
      }) as unknown as Html5QrcodeInstance;
      html5QrCodeRef.current = scanner;
      void scanner
        .start(
          { facingMode: "environment" },
          buildMobileScanConfig(),
          (decodedText: string) => {
            if (!isMounted || confirmingRef.current || previewRef.current) return;
            setPreview({
              raw: decodedText,
              label: formatQrScanPreviewLabel(decodedText),
              detail: formatQrScanPreviewDetail(decodedText),
            });
          },
          () => {
            // ignore continuous scan errors
          },
        )
        .catch((err: unknown) => {
          console.error("Error starting scanner", err);
          if (!isMounted) return;
          if (onCameraError) onCameraError();
          else onCancel?.();
        });
    });

    return () => {
      isMounted = false;
      stopScanner();
    };
  }, [readerId, onCancel, onCameraError]);

  useEffect(() => {
    if (!onCancel) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (previewRef.current) {
          setPreview(null);
          return;
        }
        onCancel();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onCancel]);

  const confirmPreview = () => {
    if (!preview || confirmingRef.current) return;
    confirmingRef.current = true;
    const raw = preview.raw;
    setPreview(null);
    stopScanner();
    onDecode(raw);
  };

  const frameBorder = preview ? IOS_YELLOW : "rgba(59,130,246,0.8)";

  const scannerViewport = (
    <div
      className={
        layout === "fill"
          ? "relative w-full h-full min-h-[240px]"
          : "relative w-full max-w-[280px] aspect-square mb-8"
      }
    >
      <div
        className={
          layout === "fill"
            ? "absolute inset-0 overflow-hidden bg-black"
            : "absolute inset-0 border-2 rounded-3xl overflow-hidden bg-bg-secondary/50"
        }
        style={layout === "fill" ? undefined : { borderColor: frameBorder }}
      >
        <div
          id={readerId}
          className="qr-scanner-reader w-full h-full overflow-hidden"
        />

        {layout === "fullscreen" && (
          <div
            className="absolute left-0 right-0 h-0.5 shadow-[0_0_8px_2px_rgba(255,214,10,0.45)] animate-scan-line z-10"
            style={{ backgroundColor: IOS_YELLOW, opacity: preview ? 0.9 : 0.5 }}
          />
        )}

        <div
          className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 rounded-tl-3xl z-20 pointer-events-none"
          style={{ borderColor: frameBorder }}
        />
        <div
          className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 rounded-tr-3xl z-20 pointer-events-none"
          style={{ borderColor: frameBorder }}
        />
        <div
          className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 rounded-bl-3xl z-20 pointer-events-none"
          style={{ borderColor: frameBorder }}
        />
        <div
          className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 rounded-br-3xl z-20 pointer-events-none"
          style={{ borderColor: frameBorder }}
        />

        {layout === "fullscreen" && !preview && (
          <div className="absolute bottom-4 left-0 right-0 text-center z-20 pointer-events-none px-3">
            <span className="text-[10px] font-mono text-accent/80 tracking-[0.3em] uppercase">
              Align QR
            </span>
            {isIosDevice() && (
              <p className="text-[10px] text-text-secondary mt-1 leading-snug">
                Hold 8–12 in. from the tag. Tap the yellow pill when it appears.
              </p>
            )}
          </div>
        )}
      </div>

      {layout === "fill" && !preview && isIosDevice() && (
        <div className="absolute bottom-2 left-0 right-0 text-center z-20 pointer-events-none px-2">
          <p className="text-[10px] text-text-secondary leading-snug">
            Hold 8–12 in. from tag · tap yellow pill when shown
          </p>
        </div>
      )}

      {preview && (
        <ScanPreviewPill
          layout={layout}
          label={preview.label}
          detail={preview.detail}
          onOpen={confirmPreview}
          onDismiss={() => setPreview(null)}
        />
      )}
    </div>
  );

  if (layout === "fill") {
    return (
      <div className="relative w-full h-full flex flex-col min-h-0">
        {scannerViewport}
        {footer}
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-bg-primary">
      <div className="flex-1 flex flex-col items-center justify-center p-6 animate-slide-up">
        {title && (
          <p className="text-[10px] font-mono text-accent/80 tracking-[0.3em] uppercase mb-8">
            {title}
          </p>
        )}
        {(heading || subtitle) && (
          <div className="text-center mb-8 max-w-[280px]">
            {heading && (
              <h2 className="text-2xl font-bold text-text-primary mb-2">{heading}</h2>
            )}
            {subtitle && (
              <p className="text-sm text-text-secondary">{subtitle}</p>
            )}
          </div>
        )}
        {scannerViewport}
        {footer}
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="text-text-secondary text-sm font-medium py-2 px-4"
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}
