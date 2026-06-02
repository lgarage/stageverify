import { useEffect, useRef, type RefObject } from "react";
import { useLocation } from "react-router-dom";
import { portalNavFocus, scrollPortalFocus } from "./dispatcherPortalNav";

/** Scroll main portal content when `?focus=` is present (HashRouter-safe). */
export function usePortalNavFocus(): RefObject<HTMLDivElement | null> {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const location = useLocation();

  useEffect(() => {
    const focus = portalNavFocus(location.search);
    if (!focus) return;
    const id = window.requestAnimationFrame(() => {
      scrollPortalFocus(focus, scrollRef.current);
    });
    return () => window.cancelAnimationFrame(id);
  }, [location.pathname, location.search]);

  return scrollRef;
}
