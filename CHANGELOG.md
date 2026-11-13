# Changelog

## 0.2.0 — 2026-11-14

- Replace the standalone web app and HACS dashboard card with a Home Assistant app installed from the Apps store.
- Ingress web UI, optional sidebar entry and automatic server-side Supervisor authentication.
- Persisted app-wide device mapping, read-only HA bridge and existing radar views/history.
- Home Assistant app documentation, configuration validation and container checks for amd64 and aarch64.

## 0.1.1 — 2026-11-14

- Install/open links for Home Assistant Marketplace and legacy HACS.
- Danish step-by-step GitHub installation and troubleshooting guide.
- HACS manifest cleanup and repository topics for discovery.
- Automated validation with the official HACS action.
- Normal GitHub release channel for installation without enabling prereleases; the app is still an early preview.

## 0.1.0 — 2026-11-14 (preview)

- Shared Danish dashboard for standalone use and a Home Assistant custom card.
- MR60BHA2 and MR60FDA2 device profiles and explicit entity mapping.
- Live Home Assistant WebSocket state handling, reconnect and in-memory credentials.
- Conservative handling of missing/stale readings, distance units and vital-estimate conditions.
- Recorder history, per-device plots, fall-signal history and CSV export.
- Warm burgundy/rose styling and responsive layouts.
- Synthetic demo, card editor test harness, 21 automated scenarios and installation examples.
