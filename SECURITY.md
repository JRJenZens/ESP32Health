# Security and privacy

ESP32Health reads states, device/entity/area registries and Recorder history from the Home Assistant instance chosen by the user. It does not call Home Assistant service actions. The underlying HA credential still has the permissions of its user; use an appropriately restricted account where supported.

Standalone credentials are held in page memory only. Entity mappings and the HA base URL are saved in local storage. Demo data is synthetic. There is no analytics SDK, remote font, external CDN, application cloud database or token proxy. Anyone who can run scripts in the app's origin or control the device/browser may access its current session. Self-host only trusted copies and use HTTPS for traffic outside a trusted local network.

The custom card uses the existing HA session. Its code and configuration execute within that trusted frontend. CSV exports are local downloads and may contain personal sensor information when connected to real devices; do not attach real exports to public issues.

For a suspected credential leak, revoke the affected token in Home Assistant first. Report vulnerabilities privately using GitHub's private vulnerability reporting if enabled. Otherwise contact the repository owner through an existing private channel; do not post secrets in a public issue.
