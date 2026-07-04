import { useDispatcherPortal } from "./DispatcherPortalContext";

/** @deprecated Prefer useDispatcherPortal — shared across all dispatcher tabs. */
export function useDispatcherGmailRefresh() {
  return useDispatcherPortal();
}
