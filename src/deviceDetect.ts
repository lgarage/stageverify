export function isIOSSafari(): boolean {
  return (
    typeof navigator !== "undefined" &&
    /iPhone|iPad|iPod/i.test(navigator.userAgent) &&
    !/CriOS|FxiOS|EdgiOS/i.test(navigator.userAgent)
  );
}
