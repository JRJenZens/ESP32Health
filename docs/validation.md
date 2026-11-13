# Preview validation

Version: 0.1.0. Development validation date: 14 November 2026 (Europe/Copenhagen).

- Node.js 22.16.0: 21/21 scenarios passed through `node --test tests/health.test.js`.
- JavaScript syntax checked for the card, standalone app, HA adapter, demo and scenarios.
- Static server returned HTTP 200.
- Browser: standalone synthetic demo and history rendered; desktop width 1440 and mobile width 390 checked. The mobile document had no horizontal overflow.
- Browser: custom card harness rendered `setConfig`/`hass` input, active fall banner, connection loss with unknown current values and the visual editor's `config-changed` event.
- Screenshots use synthetic data only.
- Source reviewed for accidental tokens/private data before publication.

Not yet verified: physical radar measurements, real Home Assistant authentication/state/history integration, installation in a live Lovelace dashboard, HACS installation, iOS Safari on a physical phone, and long-running browser/resource use. Mock protocol and browser-contract tests do not replace these checks.
