# Validation — Home Assistant app 0.2.0

Date: 14 November 2026, Europe/Copenhagen.

## Software and browser checks

- Python 3.13: 15 backend tests passed. Covers ingress checks, local health endpoint, CSRF header, config validation, atomic persistence/restart, concurrent-edit conflicts, history access scoping, redaction, SSE queue behavior and a real mock WebSocket handshake/state removal/disconnection/reconnection.
- Node.js 22: 16 shared sensor scenarios passed. Covers invalid and unavailable values, distance units, vital-estimate conditions, stale timestamps, configuration validation, conservative discovery, compressed history and CSV escaping.
- Browser fixture uses the full app/backend under `/api/hassio_ingress/synthetic/`, with synthetic data and no connection to a real Home Assistant.
- Verified automatic data loading without URL/token fields, Recorder-shaped history and entity setup. A changed area was saved and remained after reloading the browser.
- Desktop width 1440 and mobile width 390 visually checked; no horizontal overflow at mobile width. Screenshots are synthetic fixtures.

## Package checks

GitHub Actions validates app configuration with the Home Assistant app linter and builds/starts the Docker image for both `linux/amd64` and `linux/arm64`. The smoke test checks the app's health endpoint with a synthetic Supervisor credential; it does not authenticate to a real Home Assistant. See the Actions result for the released commit.

## Remaining verification

Installation on the user's Home Assistant OS, authentication through their actual Supervisor/Ingress, their Recorder configuration, physical radar behavior, physical iOS Safari and long-running resource behavior have not been verified. A successful image build and mock-protocol test do not establish radar accuracy or alarm reliability.
