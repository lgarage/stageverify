import { useEffect, useState } from "react";

const PHONE_MQ = "(max-width: 767px)";

/** Matches portal CSS `@media (max-width: 767px)` — phone shell / content layout. */
export function useIsPhonePortal(): boolean {
  const [isPhone, setIsPhone] = useState(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return false;
    }
    return window.matchMedia(PHONE_MQ).matches;
  });

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }
    const mq = window.matchMedia(PHONE_MQ);
    const onChange = () => setIsPhone(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  return isPhone;
}
