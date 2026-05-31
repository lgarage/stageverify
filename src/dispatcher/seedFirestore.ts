import { collection, getDocs, writeBatch, doc } from "firebase/firestore";
import { db } from "../firebase";
import {
  deliveryOrders,
  items,
  jobs,
  vendors,
  stagingLocations,
  statusHistory,
  pickupEvents,
  purchaseOrders,
} from "./mockData";

export async function seedFirestore(): Promise<void> {
  const snap = await getDocs(collection(db, "deliveries"));
  if (!snap.empty) return;

  console.log("Seeding Firestore with mock data...");
  const batch = writeBatch(db);

  const seed = <T extends { id: string }>(colName: string, arr: T[]) => {
    for (const item of arr) {
      batch.set(doc(db, colName, item.id), item);
    }
  };

  seed("deliveries", deliveryOrders);
  seed("items", items);
  seed("jobs", jobs);
  seed("vendors", vendors);
  seed("stagingLocations", stagingLocations);
  seed("statusHistory", statusHistory);
  seed("pickupEvents", pickupEvents);
  seed("purchaseOrders", purchaseOrders);

  await batch.commit();
  console.log("Firestore seeded.");
}
