# Security and privacy

ESP32Health is a Home Assistant app. Its web interface accepts production requests only from Supervisor Ingress (`172.30.32.2`); it exposes no host port and is intended for HA administrators. Home Assistant handles ingress login. A developer-only fixture can construct a local test application; the production entrypoint always requires the Supervisor environment and ingress protection.

`homeassistant_api: true` gives the Python backend privileged HA API access using `SUPERVISOR_TOKEN`. The credential stays in backend memory, is never returned to the browser or stored in configuration, and is not logged. Do not copy it into bug reports. No Supervisor-management, Docker-socket, host-network or hardware permissions are requested.

The backend permits an explicit allowlist of HA read commands. The browser can read sensor metadata, device suggestions and mapped sensor values, save the app's own configuration, and request at most 24 hours of history for configured entities. It has no generic service/API proxy. Unselected sensor values are redacted. The software does not modify ESPHome firmware or HA device settings and sends no alarm notifications.

Configuration is written atomically to `/data/config.json`, with revision checks against concurrent edits. It contains entity mappings and labels, not credentials. History stays in Recorder; CSV exports may contain personal sensor information. There is no external analytics SDK, CDN or cloud database.

For security reports use GitHub private vulnerability reporting if available, or an existing private channel to the owner. Do not post real sensor exports, tokens or unredacted household diagnostics in public issues.
