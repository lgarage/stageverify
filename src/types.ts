export type OrderStatus = "Pending" | "Partial" | "Complete";
export type ItemStatus = "Delivered" | "Partial" | "Backordered" | "Damaged";

export interface LineItem {
  id: string;
  description: string;
  quantity: number;
  deliveredQty: number;
  missingQty: number;
  status: ItemStatus | null;
}

export interface Order {
  id: string;
  vendor: string;
  jobName: string;
  jobNumber: string;
  siteNumber: string;
  zoneId: string;
  additionalZoneIds?: string[];
  status: OrderStatus;
  items: LineItem[];
  createdAt: string;
  confirmedAt: string | null;
  vendorNote?: string;
}

export interface StagingZone {
  id: string;
  label: string;
  description: string;
  currentOrderId: string | null;
}

export interface ConfirmationLog {
  id: string;
  orderId: string;
  vendor: string;
  jobName: string;
  jobNumber: string;
  siteNumber: string;
  zoneId: string;
  status: OrderStatus;
  confirmedAt: string;
  items: LineItem[];
  vendorNote?: string;
}
