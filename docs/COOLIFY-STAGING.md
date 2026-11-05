# EventFlow — Coolify Staging Deployment (V1.4.4 beta)

This document describes an **isolated staging setup**, not approval for public production.

## Before deploying
1. Back up the current local `EVENTFLOW_DATA` directory, including `data.json`, `media/`, and `backups/`.
2. Do not copy existing production data into Coolify without a separate restore rehearsal and authorization.
3. Create a staging subdomain with HTTPS. Confirm TCP/443 is available to the intended users.
4. Use the feature branch `feature/live-console-v14-foundation` while testing; leave `main` and the Windows production instance unchanged.

## Coolify configuration
- Source: `krvasanth64/EventFlow`, branch `feature/live-console-v14-foundation`.
- Build pack: **Dockerfile**; Dockerfile location: `./Dockerfile`. The Docker build uses `npm ci --omit=dev` against the committed `package-lock.json`.
- Application port: **8765** (internal).
- Container environment: `NODE_ENV=production`, `HOST=0.0.0.0`, `PORT=8765`, `EVENTFLOW_DATA=/data`, `EVENTFLOW_SECURE_COOKIES=1`, `EVENTFLOW_PUBLIC_ORIGIN=https://your-staging-subdomain.example.com` (replace with exact real HTTPS origin).
- Initial admin: supply `EVENTFLOW_ADMIN_PASSWORD` privately as a Coolify secret, **only when bootstrapping a new empty database**, then remove it from deployment configuration after admin creation.
- Data: persistent named volume mounted at `/data`. The Node process runs as UID/GID **10001**. Ensure the volume is writable by that identity. This volume must survive rebuild/redeploy/restart.
- Scale: **one replica only**. Never run two Node processes against the same JSON database directory.
- Health check: `GET /api/health` returning `ok: true` (Dockerfile already defines an internal check).
- Proxy: use TLS/HTTPS, allow Server-Sent Events streaming (`/api/stream`), and configure generous idle timeouts for long-running connections.

## Limitations before live release
- EventFlow currently stores sessions and edit leases in memory. Redeployments log users out and clear transient leases. Coordinate updates between events.
- Secure cookies only activate when `EVENTFLOW_SECURE_COOKIES=1`; local plain HTTP testing should leave this unset.
- This beta does **not** implement fully audited production CSRF protections, durable shared session storage, advanced login rate limiting, or multiple independent replicas.
- External URLs are not downloaded in DJ ZIP. Clickable HTML link sheets require browser/internet access for online sources.
- Managed media ZIP uses ZIP32; exports beyond its limits require ZIP64 or another streaming approach.
- A successful Docker image build is not equal to staging acceptance.

## Staging validation sequence
1. Verify HTTPS login, logout, Viewer denial and Live Controller permission.
2. Create one dummy event and upload an MP3/MP4. Verify playback on the DJ computer.
3. Test editor lock, simultaneous Viewer/LED Timeline in another browser, countdown and pause/resume synchronization.
4. Download `DJ package (ZIP)`, `DJ URLs (CSV)`, `DJ link sheet (HTML)`, and administrator full backup.
5. Open the DJ ZIP's `DJ_LINK_SHEET.html`. Verify the uploaded file link works from an extracted folder and external URLs open safely in a separate browser tab.
6. Restart the Coolify service and confirm users/events/uploads remain in `/data`. In-memory logins may expire.
7. Restore a full backup into a **separate staging deployment** and verify event count, source files and logins.
8. Confirm mobile navigation, role authorization, and the event-day backup/rollback runbook.
9. Only after signed off: decide whether to merge PR to `main` and deploy to the public production domain.

## Local Windows verification after pulling the branch
```powershell
cd D:\EventFlow-V14-Test
git pull --ff-only origin feature/live-console-v14-foundation
node --check server.js
npm test
# Stop the previous test server first, then:
$env:HOST = '127.0.0.1'
$env:PORT = '8766'
$env:EVENTFLOW_DATA = 'D:\EventFlow-V14-Data'
node server.js
```

Do not put backup ZIP files or user credentials into GitHub, Docker image layers, or public web directories.

## V1.4.8 readiness update
- [x] Dependency lockfile committed to feature branch at `c37f96e`; Docker and CI now use reproducible `npm ci`.
- [x] Local Windows V1.4.8 health check reported `ok: true`, `users: 1`; server runtime no longer appears to be failing. Authentication was not independently tested on the user's browser.
- [ ] Local `npm audit` still reports **two moderate issues**, including the ExcelJS transitive `uuid@8.3.2`. Review remediation before public launch; do not blindly force an ExcelJS major downgrade.
- [ ] Validate the Docker build and deployed Coolify host under HTTPS; do not equate passing GitHub Actions with a running staging application.
- [ ] Confirm media playback, SSE, PDF configuration, imports, and full restore rehearsal on separate data volume.
