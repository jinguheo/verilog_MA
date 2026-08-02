# Next session note (2026-07-31)

- The legacy `dashboard/` static UI was removed; `my_dashboard/` is the sole UI.
- React dashboard: `http://127.0.0.1:5173/`
- Knowledge API: `http://127.0.0.1:8788/api/overview`
- Port 8787 had unrelated/conflicting listeners, so the project API intentionally uses port 8788.
- The API sends a CORS header for the Vite dashboard origin.
- User preference: always end server/dashboard-related responses with the web address.
