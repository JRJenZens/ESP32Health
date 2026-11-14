# Validation — Home Assistant app 0.5.2

Date: 14 November 2026, Europe/Copenhagen.

## Software and browser checks

- Python 3.13: 60 backend tests passed. Covers ingress checks, local health endpoint, CSRF header, config validation, atomic persistence/restart, concurrent-edit conflicts, history access scoping, redaction, SSE queue behavior and a real mock WebSocket handshake/state removal/disconnection/reconnection.
- Node.js 22: 40 shared sensor, monitor and setup scenarios passed. Covers invalid and unavailable values, distance units, vital-estimate conditions, stale timestamps, configuration validation, conservative discovery, compressed history and CSV escaping. Additional cases cover generic ESP32 model names, Danish radar signatures, explicit manual ESPHome selection, ambiguous readings, device-scoped lists, duplicate prevention and waiting for configuration persistence before history.
- Browser fixture uses the full app/backend under `/api/hassio_ingress/synthetic/`, with synthetic data and no connection to a real Home Assistant.
- Verified automatic data loading without URL/token fields, Recorder-shaped history and entity setup. A changed area was saved and remained after reloading the browser.
- Desktop width 1440 and mobile width 390 visually checked; no horizontal overflow at mobile width. Screenshots are synthetic fixtures.

- Advisory alert cases cover explicit opt-in, threshold validation, spatial/freshness gating, independent rates, sustained-condition delays, interruption/rearming, cooldowns, persistence/restart deduplication, distinct notification tags, delivery failure, rule removal and fall signals. HTTP tests verify target validation; a mock bridge checks fixed notification payloads and rejects generic actions.
- The full synthetic browser fixture saved and triggered a threshold rule, showed the event/delivery log, and kept the save button usable. No live phone notification was sent.

- Notification cases verify default-normal migration, critical validation, exact normal/critical payloads, rejection of arbitrary services/fields, test sending without arming, configuration remaining unchanged by tests, HTTP rate limiting, visible test failures and a cooldown that survives rule edits/legacy event logs. UI tests cover saved priority and test actions without saving rules.

- Tier checks cover migration/idempotence of ordinary and critical legacy settings, severity/range validation, independent metric/direction/level durations, simultaneous critical precedence, timer reset, escalation during ordinary cooldown, pending restart and active deduplication, and migration of critical-event cooldowns.
- The full browser fixture triggered an ordinary alert after 3 seconds and a critical escalation after 8 seconds. These are synthetic test values, not clinical recommendations. Mobile width 390 showed both levels without horizontal overflow.

- LED tests cover same-device ownership, rejection of calibration/other-device selectors, fixed service payloads, critical precedence, pending/disabled rules, unchanged-value heartbeat, reconnect/retry behavior, removal/disable cleanup, config persistence and duplicate binding rejection. UI tests cover status/log below forms, scoped LED options and preserving alarm settings when saving LED configuration.
- Both radar firmware configurations validated, compiled and uploaded successfully. Live HA light states showed yellow/red/green and local blue watchdog fallback; physical colors were confirmed by the operator.

- Migration tests cover export/import across independent installations, preservation of active-alarm deduplication and cooldowns, restart, rejection of existing installations, CSRF, invalid archives, foreign LED controls and rollback on storage failure. Brightness checks cover ownership, integer 0–100 limits, fixed number actions, reconnect and avoiding repeated writes on heartbeats.

## Package checks

GitHub Actions validates app configuration with the Home Assistant app linter and builds/starts the Docker image for both `linux/amd64` and `linux/arm64`. The smoke test checks the app's health endpoint with a synthetic Supervisor credential; it does not authenticate to a real Home Assistant. See the Actions result for the released commit.

## Remaining verification

The existing 0.2.0 app was verified through a real Home Assistant Ingress session: device mappings saved and current sensor states and Recorder history were displayed. The 0.2.1 manual device controls were also checked through real Ingress. The 0.3.0 monitor and alerts were checked with synthetic fixtures; real notification delivery is not established by these tests. Physical radar accuracy, physical iOS Safari and long-running resource behavior have not been verified. A successful image build and mock-protocol test do not establish radar accuracy or alarm reliability.
