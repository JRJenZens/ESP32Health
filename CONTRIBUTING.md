# Contributing

The active distribution is a Home Assistant app. Runtime code and its Docker build context live in `esp32health/`. Keep the UI in Danish, the warm burgundy/rose style and all frontend URLs relative for Ingress. The older 0.1 standalone/card distributions are historical tags and should not be reintroduced.

Run the Python tests with Python 3.13 and `esp32health/requirements.txt`, and run `npm test` with Node.js 20+. Use synthetic data only. `tests/preview.py` provides a synthetic browser fixture under an Ingress-like prefix and is not included in the app container.

Do not add generic HA command proxies or expose Supervisor tokens to the frontend. The only permitted HA write path is the fixed backend notification method used by explicitly enabled advisory rules; do not expand it to arbitrary service actions. Configuration must remain in the app's private data directory. Include focused tests for meaningful behavior changes and update the app version/changelog for releases.

For issues provide the sensor model, ESPHome version, Home Assistant version and a minimal redacted example. Never upload real health records, Wi-Fi passwords, API keys or private household exports.
