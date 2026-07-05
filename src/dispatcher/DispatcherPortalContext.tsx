import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type {
  StagingLocation,
  ShopStockLocationMapping,
  Vendor,
  VendorInvoiceImportReview,
} from "./models";
import {
  getEmailProviderConnection,
  triggerInboundGmailSync,
  listVendorInvoiceImports,
  ensureApprovedUnlinkedInvoiceShells,
  listVendors,
  listAllZones,
  mapActiveZoneOccupancyByCode,
  listShopStockMappings,
  type ZoneOccupancySummary,
} from "./firestoreService";
import { formatGmailSyncMessage } from "./formatGmailSyncMessage";
import { mapActiveShopStockReservationsByCode } from "./shopStockMapping";

export type DispatcherZonesSnapshot = {
  zones: StagingLocation[];
  occupancyByZoneCode: Record<string, ZoneOccupancySummary>;
  shopStockByCode: Record<string, ShopStockLocationMapping>;
};

type DispatcherPortalContextValue = {
  emailProviderConnected: boolean;
  refreshBusy: boolean;
  gmailSyncMessage: string | null;
  invoiceShellBackfillErrors: string[] | null;
  lastUpdated: string | null;
  refreshGeneration: number;
  invoiceImports: VendorInvoiceImportReview[] | null;
  vendors: Vendor[] | null;
  zonesSnapshot: DispatcherZonesSnapshot | null;
  setLastUpdated: (value: string | null) => void;
  handleRefreshNow: () => Promise<void>;
  refreshPortalData: () => Promise<void>;
};

const DispatcherPortalContext =
  createContext<DispatcherPortalContextValue | null>(null);

async function fetchInvoiceImports(): Promise<{
  items: VendorInvoiceImportReview[];
  backfillErrors: string[];
}> {
  const items = await listVendorInvoiceImports({ limit: 50 });
  items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const { linkedCount, errors } = await ensureApprovedUnlinkedInvoiceShells(items);
  if (linkedCount > 0) {
    const refreshed = await listVendorInvoiceImports({ limit: 50 });
    refreshed.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return { items: refreshed, backfillErrors: errors };
  }
  return { items, backfillErrors: errors };
}

async function fetchZonesSnapshot(): Promise<DispatcherZonesSnapshot> {
  const [zones, occupancy, mappings] = await Promise.all([
    listAllZones(),
    mapActiveZoneOccupancyByCode(),
    listShopStockMappings(),
  ]);
  return {
    zones,
    occupancyByZoneCode: occupancy,
    shopStockByCode: mapActiveShopStockReservationsByCode(mappings),
  };
}

export function DispatcherPortalProvider({ children }: { children: ReactNode }) {
  const [emailProviderConnected, setEmailProviderConnected] = useState(false);
  const [refreshBusy, setRefreshBusy] = useState(false);
  const [gmailSyncMessage, setGmailSyncMessage] = useState<string | null>(null);
  const [invoiceShellBackfillErrors, setInvoiceShellBackfillErrors] = useState<
    string[] | null
  >(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [refreshGeneration, setRefreshGeneration] = useState(0);
  const [invoiceImports, setInvoiceImports] =
    useState<VendorInvoiceImportReview[] | null>(null);
  const [vendors, setVendors] = useState<Vendor[] | null>(null);
  const [zonesSnapshot, setZonesSnapshot] =
    useState<DispatcherZonesSnapshot | null>(null);

  useEffect(() => {
    void getEmailProviderConnection()
      .then((connection) => {
        setEmailProviderConnected(connection.status === "connected");
      })
      .catch(() => setEmailProviderConnected(false));
  }, []);

  const refreshSharedData = useCallback(async () => {
    const [importResult, vendorList, zones] = await Promise.all([
      fetchInvoiceImports(),
      listVendors(),
      fetchZonesSnapshot(),
    ]);
    setInvoiceImports(importResult.items);
    setInvoiceShellBackfillErrors(
      importResult.backfillErrors.length > 0 ? importResult.backfillErrors : null,
    );
    setVendors(vendorList);
    setZonesSnapshot(zones);
    setRefreshGeneration((g) => g + 1);
  }, []);

  const refreshPortalData = useCallback(async () => {
    await refreshSharedData();
    setLastUpdated(new Date().toLocaleString());
  }, [refreshSharedData]);

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
      await refreshSharedData();
      setLastUpdated(new Date().toLocaleString());
    } finally {
      setRefreshBusy(false);
      if (emailProviderConnected) {
        window.setTimeout(() => setGmailSyncMessage(null), 8000);
      }
    }
  }, [refreshBusy, emailProviderConnected, refreshSharedData]);

  return (
    <DispatcherPortalContext.Provider
      value={{
        emailProviderConnected,
        refreshBusy,
        gmailSyncMessage,
        invoiceShellBackfillErrors,
        lastUpdated,
        refreshGeneration,
        invoiceImports,
        vendors,
        zonesSnapshot,
        setLastUpdated,
        handleRefreshNow,
        refreshPortalData,
      }}
    >
      {children}
    </DispatcherPortalContext.Provider>
  );
}

export function useDispatcherPortal(): DispatcherPortalContextValue {
  const ctx = useContext(DispatcherPortalContext);
  if (!ctx) {
    throw new Error(
      "useDispatcherPortal must be used within DispatcherPortalProvider",
    );
  }
  return ctx;
}
