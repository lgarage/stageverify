# Security Audit Report - 2026-06-01

## Risk Categories

### 1. Open redirect
- **Findings**: None found.
- **Details**: `src/LoginPage.tsx` implements a robust guard in `resolvePostLoginPath` that validates the `next` parameter against internal paths only (starts with `/` and not `//`).

### 2. Unprotected route
- **Findings**: MED
- **Details**: Routes `/receive`, `/checkin/:orderId`, and `/pickup` are publicly accessible and allow unauthenticated writes to Firestore. While this is by design for mobile scan flows, it relies entirely on `firestore.rules` for security, which are currently NOT deployed.
- **File**: `src/main.tsx` (Routes definition)

### 3. Auth bypass
- **Findings**: None found.
- **Details**: `src/ProtectedRoute.tsx` correctly wraps sensitive routes (`/dispatcher`, `/settings`, `/hub`) and redirects unauthenticated users to `/login`.

### 4. Firestore exposure
- **Findings**: HIGH
- **Details**: `src/dispatcher/firestoreService.ts` uses `fetchAll` and `fetchWhere` helpers that perform direct collection scans. `listDeliveries` fetches the entire `deliveries`, `jobs`, `vendors`, `stagingLocations`, `purchaseOrders`, and `items` collections into memory on every call. This exposes the entire database structure and content to the client.
- **File**: `src/dispatcher/firestoreService.ts` (Lines 160-224)

### 5. XSS vector
- **Findings**: None found.
- **Details**: No usage of `dangerouslySetInnerHTML` was found. User-controlled content is rendered via standard React components, which provide automatic escaping.

### 6. Data validation gap
- **Findings**: HIGH
- **Details**: `createDelivery` generates `orderNumber` by fetching all deliveries and incrementing the count (`ORD-XXX`). This is a critical race condition that will lead to duplicate order numbers under concurrent use. Additionally, `submitCheckin` and `updateItemQty` lack server-side validation for input values.
- **File**: `src/dispatcher/firestoreService.ts` (Lines 701, 468, 580)

### 7. Sensitive data leak
- **Findings**: None found.
- **Details**: Firebase configuration in `src/firebase.ts` uses standard public keys. PII (emails) are abbreviated in the UI where appropriate.

### 8. DoS surface
- **Findings**: HIGH
- **Details**: `DispatcherDashboardPage.tsx` and `EntryDisplayPage.tsx` poll `listDeliveries` every 30 seconds. Since `listDeliveries` performs full collection scans of multiple large collections, this creates a significant DoS surface as the data grows. `seedFirestore.ts` also performs a collection read on every application load.
- **File**: `src/DispatcherDashboardPage.tsx` (Line 258), `src/EntryDisplayPage.tsx` (Line 72), `src/dispatcher/firestoreService.ts` (Line 160)

## Overall Verdict
**SECURITY: BLOCK**

### Summary of Findings
- **HIGH**: 3
- **MED**: 1
- **LOW**: 0

The audit has identified critical issues related to unbounded Firestore reads (DoS surface) and a data integrity race condition in order number generation. These must be addressed before deployment, especially since Firestore security rules are not yet active in the production environment.
