import type { DeliveryOrder, Item } from "./dispatcher/models";

const PROJECT_ID = "stageverify-db";
const API_KEY = "AIzaSyALKllET2wQoAm7-3RiHrRJjMsVq315WaE";
const REST_ROOT = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)`;
const REST_DOCUMENTS = `${REST_ROOT}/documents`;
const REST_RUN_QUERY = `${REST_ROOT}/documents:runQuery`;

type FirestoreValue = {
  stringValue?: string;
  integerValue?: string;
  doubleValue?: number;
  booleanValue?: boolean;
  nullValue?: null;
  arrayValue?: { values?: FirestoreValue[] };
  mapValue?: { fields?: Record<string, FirestoreValue> };
};

function parseFirestoreValue(value: FirestoreValue): unknown {
  if ("stringValue" in value && value.stringValue !== undefined) {
    return value.stringValue;
  }
  if ("integerValue" in value && value.integerValue !== undefined) {
    return Number.parseInt(value.integerValue, 10);
  }
  if ("doubleValue" in value && value.doubleValue !== undefined) {
    return value.doubleValue;
  }
  if ("booleanValue" in value && value.booleanValue !== undefined) {
    return value.booleanValue;
  }
  if ("nullValue" in value) return null;
  if (value.arrayValue?.values) {
    return value.arrayValue.values.map(parseFirestoreValue);
  }
  if (value.mapValue?.fields) {
    return parseFirestoreFields(value.mapValue.fields);
  }
  return null;
}

function parseFirestoreFields(
  fields: Record<string, FirestoreValue>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    out[key] = parseFirestoreValue(value);
  }
  return out;
}

function documentIdFromName(name: string): string {
  const parts = name.split("/");
  return parts[parts.length - 1] ?? "";
}

async function restGetDocument(path: string): Promise<Response> {
  return fetch(`${REST_DOCUMENTS}/${path}?key=${API_KEY}`);
}

/** Public delivery doc read via Firestore REST (bypasses SDK — reliable on iOS Safari). */
export async function restGetDelivery(
  deliveryId: string,
): Promise<DeliveryOrder | null> {
  const response = await restGetDocument(
    `deliveries/${encodeURIComponent(deliveryId)}`,
  );
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`Delivery REST read failed (${response.status})`);
  }
  const body = (await response.json()) as {
    name?: string;
    fields?: Record<string, FirestoreValue>;
  };
  if (!body.fields) return null;
  const data = parseFirestoreFields(body.fields) as unknown as DeliveryOrder;
  return { ...data, id: data.id ?? deliveryId };
}

/** Public items query via Firestore REST. */
export async function restGetItemsForDelivery(
  deliveryOrderId: string,
): Promise<Item[]> {
  const response = await fetch(`${REST_RUN_QUERY}?key=${API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: "items" }],
        where: {
          fieldFilter: {
            field: { fieldPath: "deliveryOrderId" },
            op: "EQUAL",
            value: { stringValue: deliveryOrderId },
          },
        },
      },
    }),
  });
  if (!response.ok) {
    throw new Error(`Items REST query failed (${response.status})`);
  }
  const rows = (await response.json()) as Array<{
    document?: { name?: string; fields?: Record<string, FirestoreValue> };
  }>;
  return rows
    .filter((row) => row.document?.fields)
    .map((row) => {
      const id = documentIdFromName(row.document!.name ?? "");
      const data = parseFirestoreFields(
        row.document!.fields!,
      ) as unknown as Item;
      return { ...data, id: data.id ?? id };
    });
}
