import { useCallback, useEffect, useState } from "react";
import {
  getEmailProviderConnection,
  triggerInboundGmailSync,
} from "./firestoreService";
import { formatGmailSyncMessage } from "./formatGmailSyncMessage";

export function useDispatcherGmailRefresh(options?: {
  onAfterRefresh?: () => Promise<void>;
}) {
  const [emailProviderConnected, setEmailProviderConnected] = useState(false);
  const [refreshBusy, setRefreshBusy] = useState(false);
  const [gmailSyncMessage, setGmailSyncMessage] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  useEffect(() => {
    void getEmailProviderConnection()
      .then((connection) => {
        setEmailProviderConnected(connection.status === "connected");
      })
      .catch(() => setEmailProviderConnected(false));
  }, []);

  const handleRefreshNow = useCallback(async () => {
    if (refreshBusy) return;
    setRefreshBusy(true);
    setGmailSyncMessage("Syncing mailbox…");
    try {
      if (emailProviderConnected) {
        const syncResult = await triggerInboundGmailSync();
        setGmailSyncMessage(formatGmailSyncMessage(syncResult));
      } else {
        setGmailSyncMessage(null);
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Mailbox sync failed.";
      setGmailSyncMessage(message);
    }
    try {
      await options?.onAfterRefresh?.();
      setLastUpdated(new Date().toLocaleString());
    } finally {
      setRefreshBusy(false);
      if (emailProviderConnected) {
        window.setTimeout(() => setGmailSyncMessage(null), 8000);
      }
    }
  }, [refreshBusy, emailProviderConnected, options?.onAfterRefresh]);

  return {
    emailProviderConnected,
    refreshBusy,
    gmailSyncMessage,
    lastUpdated,
    setLastUpdated,
    handleRefreshNow,
  };
}
