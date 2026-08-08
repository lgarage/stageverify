# Access PIN migration inventory (read-only)

**Status:** counts deferred — requires CF `migrateAccessPins` dryRun after deploy.

No Admin SDK production credentials are configured on the cloud agent VM for safe
read-only scans of `technicians`, `vendors`, or `managementPins`. Do **not** run
mutating migration against prod until Dan approves deploy.

**After CF deploy:** invoke `migrateAccessPins` with `{ dryRun: true, limit: 200 }`
via manager auth and record `byType` counts here.

**Local/emulator fixtures:** none seeded in this PR — tests cover crypto, session
helpers, and rules blocks only.
