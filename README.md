# EventFlow — Portable Event Program Manager

EventFlow is a lightweight JSON-based event agenda and show-control web app for Windows, LAN, and Tailscale. It uses Node.js built-in modules, with **no npm dependency installation**.

## Features

- Multiple events, with individual program registration, duration, gap after each program, planned start/end and finish projection.
- Program drag/drop on desktop, plus move up/down controls on mobile.
- Speeches with no source, audio/video uploads, web URLs, and existing-file path references.
- Print-ready ordered agenda with media paths; **Print > Save as PDF** in the browser.
- Admin/editor/viewer roles, user creation, password reset and account disable.
- One active editor per event; several different events may be edited simultaneously.
- Editor lease renewed every 30 seconds, 90-second expiry, and admin takeover.
- Real-time change notifications, revision conflict protection and atomic JSON writes.
- Mobile-friendly responsive interface and home-screen manifest.
- Live operator controls (start/finish/skip) with actual timestamps and countdown.

## Windows first-time installation

1. Install Node.js LTS (20 or newer) from https://nodejs.org/ and enable PATH.
2. In GitHub, choose **Code > Download ZIP**, extract it to D:\EventFlow, or clone:

       git clone https://github.com/krvasanth64/EventFlow.git D:\EventFlow

3. Double-click **start-eventflow.bat**.
4. On first startup, enter a private admin password (8+ characters). Initial username is **admin**. No password is hardcoded or published.
5. Open http://localhost:8765 in a browser and sign in.
6. Create an event, open Program Planner, select **Edit This Event**, and add programs.
7. Use **Team & Access** as admin to create Editors and Viewers.

Keep the server terminal window open while the app is in use. To stop, press Ctrl+C.

## Tailscale remote access (recommended)

1. Run EventFlow on your PC as above; keep it bound to localhost.
2. Install/sign in to Tailscale on the host PC.
3. In a PowerShell terminal, run:

       tailscale serve --bg --https=443 http://127.0.0.1:8765
       tailscale serve status

4. Open the HTTPS tailnet URL shown by Tailscale from another authorized Tailscale device.
5. On mobile, sign in to Tailscale, open the URL and optionally use browser **Add to Home Screen**.
6. To disable Serve:

       tailscale serve reset

CLI options may vary by Tailscale release; use tailscale serve --help for your installed version. **Do not enable Tailscale Funnel by default**, since Funnel exposes the site to the public internet.

## Office LAN

The default bind address is 127.0.0.1 (host-only). To accept LAN browser connections instead, start in PowerShell:

       cd D:\EventFlow
       $env:HOST = "0.0.0.0"
       node server.js

Clients can access http://YOUR-PC-LAN-IP:8765 after a Private-network Windows Firewall rule permits the host port. Avoid opening this port to the public internet.

## Storage / portability

Default storage is the runtime folder inside EventFlow; it is automatically excluded by .gitignore:

       EventFlow\
         server.js
         public\
         start-eventflow.bat
         runtime\
           data.json
           media\<event-id>\
           backups\

To choose a separate folder for storage, run in PowerShell:

       cd D:\EventFlow
       $env:EVENTFLOW_DATA = "D:\EventFlowData"
       node server.js

For a complete backup, stop the host and copy the entire runtime folder, including media. JSON snapshots are generated automatically every 20 writes, retaining up to 30 copies; they do not include the media file bytes.

To migrate, stop the old server, copy the application plus the whole runtime folder to another PC, set EVENTFLOW_DATA accordingly, and run **only one host server** for this database. External linked-file references may need adjustment.

**Do not commit runtime/, media, backups, admin secrets, or .env files to the public repository.**

## Working instructions

1. Create an event with a unique name/date/start time.
2. Acquire the editing lease. One Editor can edit Event A while another edits Event B. Viewers see changes live but cannot modify.
3. Register programs with unique event-level titles, types, presenter, duration (minutes), transition gap (minutes) and instructions.
4. Choose source: No source for speeches, Upload File for managed audio/video, Web URL for external links, or Linked File for a host path reference.
5. Drag programs into their running order (or use the Up/Down buttons on mobile).
6. Review recalculated timing, end time and media references.
7. In Live Control, manually Start/Finish/Skip programs. Actual timestamps do not replace the original planned schedule.
8. In Reports, choose **Print / Save as PDF** and select the PDF destination from the browser dialog.

## Known V1 limitations

- Reports require browser Save as PDF; they are not rendered by the server.
- Host-path references are metadata only, not automatically streamed to mobile devices. Upload managed media for cross-device playback.
- Some websites prevent inline playback; use Open URL.
- Autoplay may be blocked by browsers; live advancement remains manual.
- Sessions are in memory and users must sign in again after a server restart.
- EventFlow is designed for a single Node.js host and ordinary event volumes; it is not a clustered JSON database.
- Deleted program entries may leave media files requiring manual cleanup.
- A simple account system is suitable for a private trusted tailnet, not an open public service.

## Developer commands

       node --check server.js
       node --check public/app.js
       npm start

Node.js 20+ is required. No npm install is necessary. The first admin password can also be provided to the first run via EVENTFLOW_ADMIN_PASSWORD environment variable. Avoid putting passwords in tracked files.

## License

No open-source license is selected yet. Publicly readable source does not automatically grant reuse rights.
