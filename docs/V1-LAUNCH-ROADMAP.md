# EventFlow V1.0 Launch Roadmap

Last updated: 2026-11-04. Target: stable Windows-hosted, Tailscale-accessible event production app.

## Verified

| Area | Status | Evidence |
|---|---|---|
| Windows host startup | Observed working | Host PC screenshot and Node output |
| Tailscale Serve | Observed working | Tailnet HTTPS proxy and authenticated browser screenshot |
| Admin login | Observed working | EventFlow dashboard screenshot |
| JSON event persistence | Observed working | "PK Day - 2026" displayed |
| Admin creates Editor | Observed working | Team page shows second Editor account |
| JavaScript syntax and backend integration | Passed in CI | GitHub Actions run 41787744993 |
| DOM selector crash on Team page | User confirmed fixed | Acceptance check 2026-11-04 |
| Event chooser / shared selection | User confirmed passed | Header picker; Planner and Reports accessible |
| SSE and polling fallback | SSE lifecycle corrected; automated test passed; Tailscale device retest pending | Tests media_stream.test.js, CI run 41788754862 |

## Second-stage implementation (2026-11-04)

- Corrected the live SSE subscriber lifecycle: subscribe for the streaming *response* lifetime, not request lifetime.
- Added a ready event for live clients and retained the 15-second fallback polling.
- Added upload-time event revision verification (both before and after streaming) to avoid stale uploads overwriting a concurrently edited program.
- Live Finish button is disabled until a program is started.
- Added independent integration coverage for authenticated SSE broadcasts, rejected stale media uploads, MP4 upload persistence, byte-range playback, and unauthenticated media denial.
- CI run 41788754862 passed. These are automated tests only; no claim of phone/browser Tailscale acceptance.

## V1.0 acceptance checklist (must be completed on actual host devices)

- [ ] Restart host with latest main; hard-refresh desktop and mobile browsers.
- [x] Verify header event picker, event availability, Planner and Reports selection. Live Control route remains included in second-stage device testing.
- [x] Verify Team & Access Manage button opens without a JS error.
- [ ] Create 5 programs of different types. Single speech with no media: **passed**.
- [ ] Drag/drop and move up/down; check calculated program start/end, duration and changeover gaps.
- [ ] Upload MP3 and MP4; confirm preview/seek from desktop and mobile over Tailscale.
- [ ] Register web URL; verify external link and fallback for sites preventing embed.
- [ ] Confirm full event agenda PDF via browser Print > Save as PDF, including media references.
- [ ] Two users: one editor for Event A, view-only on Event A for second user.
- [ ] Two users: second editor on Event B at same time; both changes persisted.
- [ ] Admin takeover, editor lease expiry, stale-revision rejection, no lost updates.
- [ ] Run live controls start/finish/skip and confirm actual timestamps survive restart.
- [ ] Test small mobile portrait screens: forms, navigation, event selector, buttons.
- [ ] Copy runtime folder backup and verify restore on isolated test host.
- [ ] Change initial admin password to a nontrivial value; do not store secrets in repo.
- [ ] Tag v1.0 only after acceptance criteria above pass.

## Known remaining product gaps (not silently marked complete)

| Priority | Feature | Status |
|---|---|---|
| P0 | Persist event selection across pages and Team Manage exception | User acceptance passed |
| P0 | Media uploads/streaming under Tailscale | Implemented; actual media test pending |
| P0 | Per-event leases in two real browser sessions | Backend test passed; user acceptance pending |
| P0 | Mobile usability and playback | Responsive CSS present; device test pending |
| P0 | Print/PDF output | Browser print implemented; report QA pending |
| P1 | Rich automatic media status / missing-file checks | Not implemented |
| P1 | User-visible event archive/delete and completion workflow | Backend supports some operations; full UI pending |
| P1 | True offline mode and silent media autoplay | Not in V1 scope |
| P1 | Automatic operator run-sheet PDF stored in server folder | Not in V1 scope (browser print is V1 export) |
| P1 | Complete continuous browser E2E testing | Not implemented |

## Windows update procedure

1. Stop the EventFlow console with Ctrl+C; do not delete runtime.
2. In PowerShell, run:
   ```powershell
   cd D:\EventFlow
   git pull --ff-only origin main
   ```
3. Double-click start-eventflow.bat. The existing admin account remains stored in runtime.
4. Open the Tailscale URL and hard refresh with Ctrl+Shift+R.
5. Test **PK Day - 2026** from the global header Event dropdown. Check Team > Manage.
6. Complete remaining checklist with desktop and phone on your tailnet.

Record observed pass/fail results before declaring V1.0 released. Keep Tailscale Funnel disabled. Never commit the runtime folder. The user confirmed six initial UI checks, but video upload, phone playback, print rendering and two-device concurrency remain unverified.
