# stageverify � Zone Management + ESL Integration Plan

> **Not in MVP scope (D-26, 2026-07-12):** E-tags / ESL / Minew are **excluded from MVP** entirely — not in `MVP_PATH.md` %, exit criteria, or blockers. Revisit as post-MVP product work with requirements restated + verify/tests.
>
> Full context for the Zone Management page + MinewTag e-ink label integration (post-MVP).

## Hardware Inventory

| Physical Role | Tag Size | Model | Tag ID (from label barcode) | Mounting |
|---|---|---|---|---|
| Entryway overview board | 7.3" (800�480) | RS075 | E0000001BC48 | Entryway wall |
| Floor/ground zone tags | 4.2" (400�300) | DS042Q | E100000066578 (+ others in kit) | Wall at eye level above floor delivery |
| Shelf zone tags | 3.5" (384�184) | DS035Q | E100000083887 (+ others in kit) | Shelf edge |

Gateway: G1-E (ethernet/PoE, BLE 5.0). Must be on-site with ethernet to push updates to tags.
MinewTag cloud platform login: PENDING � waiting on MinewTag to provide credentials for the demo kit.

## Zone Type Conventions

| Zone type (in code) | Physical location | Tag size | Code prefix | Examples |
|---|---|---|---|---|
| "ground" | Floor delivery � tag on wall at eye level above package | 4.2" DS042Q | G | G1, G2, G3 |
| "shelf" | Shelf storage � tag on shelf edge | 3.5" DS035Q | S | S1A, S1B, S2A |
| "bin" | (future) | � | B | � |
| "other" | (future) | � | � | � |

Zone locations are STATIC/PERMANENT physical spots. No jobId on zones � they are global.

## Firestore Schema (Final)

### StagingLocation (collection: stagingLocations)
```typescript
export interface StagingLocation {
  id: string;          // Firestore document ID
  code: string;        // "G1", "S1A" � must be unique
  label: string;       // "Ground 1", "Shelf 1A"
  type: "ground" | "shelf" | "bin" | "other";
  active: boolean;     // soft-delete
  notes?: string;      // optional: "Near dock entrance"
  sortOrder?: number;  // for ordering in management list
  eslTagId?: string;   // MinewTag tag ID � links zone to its physical e-ink label
}
```

### appSettings/config additions (for entryway board)
Add to AppSettings interface:
```typescript
entrywayEslTagId?: string;  // "E0000001BC48" � the 7.3" entryway overview tag
```

## E-Ink Label Content Design

### Individual Zone Tags (4.2" ground / 3.5" shelf)
Always shown (static):
- Zone code (large, bold) � e.g. "G1"
- Zone label � e.g. "Ground 1"
- QR code � see routing below

Dynamic (updated when delivery assigned/cleared):
- OCCUPIED: "[ORD-042] Acme Lighting � Staged 2:14 PM"
- EMPTY: "AVAILABLE"

### QR Code Routing (permanent location QR — **REJECTED: occupancy-dynamic flip**)

> **Superseded 2026-07-07** by `docs/location-first-transition-spec.md` (Phase 1). The occupancy-dynamic QR-flip design below is **explicitly rejected**. Printed zone QRs are **permanent and dumb**; software is dynamic and role-aware.

**Locked decision (Phase 1):** Every zone tag encodes one **never-changing** location URL:

`https://lgarage.github.io/stageverify/#/s?loc={code}`

(e.g. `#/s?loc=G1` for ground spot G1). The landing route is implemented in Phase 3; legacy `#/receive?zone=` and `#/receive?id=` links keep working during migration.

**E-tag premium layer (future):** E-ink tags display dynamic job/vendor/status content on the **same permanent location identity** — server-side CF push only; the QR URL **never changes** when occupancy changes.

~~### QR Code Routing (always present on zone tags)~~ *(rejected)*
~~- When EMPTY: QR encodes `https://lgarage.github.io/stageverify/#/receive?zone=G1`~~
~~- When OCCUPIED: QR encodes `https://lgarage.github.io/stageverify/#/receive?id={deliveryId}`~~

### Entryway Overview Tag (7.3" � NOT a zone tag)
Aggregates all active deliveries. Shows a directory:
```
VENDOR               ZONE   STATUS
Acme Lighting        G1     STAGED
ProAudio Inc.        S1A    STAGED
Stage Right Co.      �      PENDING
```
Updates on any delivery status change. Conceptually matches EntryDisplayPage but rendered to the e-ink board.

## Integration Architecture

### Trigger: Firestore Cloud Function (onDocumentWritten on deliveries)
When a delivery's stagingLocationId or status changes:
1. Look up the zone's eslTagId from stagingLocations collection
2. Build label content (zone code, label, delivery info or AVAILABLE)
3. POST to MinewTag cloud API with the tag ID + new content
4. Also rebuild and push entryway tag content (all active deliveries)

### MinewTag API (HTTP, needs API key)
- Base URL: TBD (provided by MinewTag with cloud login)
- Auth: API key in request header
- Request: POST /api/push or similar � tag ID + content template
- Content: text fields, QR code URL, color/style
- Firebase env vars needed: `minewtag.apikey`, `minewtag.baseurl`

### QR scan handlers (already done as of 2026-06-01)
ReceivingPage.tsx (`/#/receive`) is the canonical vendor check-in; QR deep links and compact `#/r?` hashes rewrite to receive.
They extract `?id=` or `?zone=` params from hash fragment. ?

### Print Label button (already done as of 2026-06-01)
DispatcherDashboardPage has a "Print Label" button in the delivery detail drawer.
Renders QRCodeSVG from qrcode.react. ?

## Build Sequence

### Step 1 � Zone Management Page (NO API creds needed � do this now)
Archetype: multi-file-feature | Model: Composer 2.5 | Tier: T2

Files to create/modify:
- `src/dispatcher/models.ts` � add eslTagId, notes, sortOrder to StagingLocation; add entrywayEslTagId to AppSettings
- `src/dispatcher/firestoreService.ts` � add createZone, updateZone, deleteZone (soft), listZones service methods
- `src/ZoneManagementPage.tsx` � NEW PAGE:
  - List all zones (grouped by type: ground, then shelf)
  - Per zone card: code, label, type, active status, eslTagId field, QR preview (qrcode.react), edit/deactivate buttons
  - Add Zone form: code, label, type, notes, sortOrder, eslTagId
  - "Print All Active Labels" � opens printable sheet with QR + zone info for each active zone
- `src/main.tsx` � wire /zones route (ProtectedRoute)
- Sidebar in DispatcherDashboardPage � activate the dead "Staging Map" link to point to /zones

Acceptance: /zones page lists zones, create/edit/deactivate works, QR preview shows correct URL, Print All opens printable view, build clean.

### Step 2 � Cloud Function: Zone ESL Push (NEEDS MinewTag API creds)
Archetype: backend-write-critical | Model: Composer 2.5 (trial, currently 3/5 clean passes) | Grader: Sonnet 4.6

What to build:
- `functions/src/index.ts` � add onDocumentWritten trigger on deliveries
- On stagingLocationId or status change: look up zone eslTagId, call MinewTag API, push label content
- Handle OCCUPIED vs AVAILABLE state
- Firebase config: minewtag.apikey + minewtag.baseurl

Blocker: MinewTag cloud login + API docs needed first.

### Step 3 � Entryway Board Push (NEEDS MinewTag API creds)
Archetype: backend-write-critical | Model: Composer 2.5 (trial) | Grader: Sonnet 4.6

What to build:
- Extend the Cloud Function from Step 2
- On any delivery status change: rebuild the entryway board content (all active deliveries + their zones)
- Push to entrywayEslTagId from appSettings/config
- Handle pagination if many deliveries (7.3" tag has 800�480px to work with)

Blocker: MinewTag API creds + Step 2 done first.

## Current Status
- [x] QR scan handlers URL-aware (away-010, 2026-06-01)
- [x] Print Label button in dispatcher drawer (away-011, 2026-06-01)
- [x] Step 1: Zone Management Page � SHIPPED (2026-06-01, /zones route, ZoneManagementPage.tsx)
- [ ] Step 2: ESL zone push � BLOCKED on MinewTag API creds
- [ ] Step 3: ESL entryway board � BLOCKED on Step 2 + API creds

## getDeliveryDetails Deploy Blocker � RESOLVED (2026-06-02)
Firestore rules **deployed** 2026-06-02 (public pickup batch write + rules ship). `getDeliveryDetails` split into auth/unauth variants; unauth routes use public read paths. Canonical deploy state: `docs/project_state.md` Deployment Status.
