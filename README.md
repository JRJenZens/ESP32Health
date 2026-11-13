# ESP32Health

A local-first dashboard designed specifically for **Seeed Studio MR60BHA2** and **MR60FDA2** mmWave kits connected through **ESPHome → Home Assistant**.

Use the same interface as a standalone web app on your computer, iPhone or iPad, or as a custom Home Assistant dashboard card. Danish UI, warm burgundy and rose design, no build step and no runtime dependencies.

**Version 0.1.1 is an early preview.** Software scenarios and browser layouts have been tested; physical radar behavior, installation in a live Home Assistant dashboard and HACS installation have not yet been verified. HACS support here means a custom-repository package, not inclusion in the default HACS catalog.

![ESP32Health with synthetic demonstration data](docs/preview.png)

## Features

- MR60BHA2: radar-estimated heart and breathing rates, presence, target distance, estimated target count and optional illuminance.
- MR60FDA2: presence, current fall signal and optional illuminance.
- Multiple devices with separate names, areas and explicit entity mappings.
- Device suggestions from Home Assistant's registries, plus manual entity selection.
- Live state updates through Home Assistant WebSocket; reconnect and re-authentication handling in the standalone app.
- Recorder history for 1, 6, 12 or 24 hours, per-device charts and CSV export.
- Clearly labeled synthetic demo, separate from the live configuration.
- Missing, unavailable and disconnected data stay unknown; they do not become zeros or an all-clear message.

## 1. Standalone web app

Download or clone this repository, then run a local static server from its directory:

```sh
python3 -m http.server 8320 --bind 127.0.0.1
```

Open **http://127.0.0.1:8320**, then:

1. Choose **Tilslut Home Assistant**.
2. Enter your Home Assistant base URL, such as `http://homeassistant.local:8123`.
3. Create a long-lived access token in your Home Assistant profile under **Security** and enter it in the app.
4. Open **Enheder → Find Seeed-enheder**, then review the suggested mappings. Devices without a recognizable model/name can be added manually.
5. Return to **Overblik**. Use **Historik** for Recorder history and CSV.

The token is held in JavaScript memory only and is discarded on disconnect or page exit. Reloading requires login again. The Home Assistant URL and entity mappings are stored in this browser's local storage. No real measurements or credentials are included in the repository. The app makes no service calls to alter devices or Home Assistant settings.

### iPhone / iPad

The Home Assistant card below is the easiest mobile option and uses your existing HA login. For the standalone app, serve these static files on a trusted local web server reachable from the phone. For example, to make the preview accessible on your LAN:

```sh
python3 -m http.server 8320 --bind 0.0.0.0
```

Open `http://<computer-LAN-address>:8320` on the same network. Python's development server has no login/TLS and should not be exposed to the internet. Serve only this app directory; use the Home Assistant card or an HTTPS-capable web server for regular use. If the app is loaded over HTTPS, Home Assistant must also be reachable over HTTPS/WSS. This is a responsive browser app, not a native iOS application or an offline PWA.

## 2. Install from GitHub in Home Assistant (Marketplace / HACS)

[![Open ESP32Health in Home Assistant](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/marketplace_repository/?owner=JRJenZens&repository=ESP32Health&category=plugin)

**[Dansk installationsvejledning](docs/installation-da.md)**

Use the button above in current Home Assistant versions with Marketplace. For older HACS installations, use [the legacy HACS link](https://my.home-assistant.io/redirect/hacs_repository/?owner=JRJenZens&repository=ESP32Health&category=plugin).

1. Open Marketplace/HACS, then its menu **Custom repositories**.
2. Add `https://github.com/JRJenZens/ESP32Health`, category **Dashboard** (internally `plugin`).
3. Open **ESP32Health**, select **Download**, and choose **v0.1.1** or newer.
4. Refresh the Home Assistant frontend when prompted.
5. Edit your dashboard, add the **ESP32Health** custom card, then select the radar entities in its visual editor and save.

Releases from v0.1.1 are normal GitHub releases so users do not need to enable prereleases. The software remains an early preview. This repository is added as a custom repository; it is not listed in the default catalog. HACS' own validator runs in GitHub Actions.

### Card configuration

```yaml
type: custom:esp32health-card
devices: []
```

The card uses the existing HA login. No extra access token is required. If your installation does not register dashboard resources automatically, add `/hacsfiles/ESP32Health/ESP32Health.js` as a **JavaScript module** under dashboard resources, then reload.

### Manual installation (alternative)


1. Copy **`dist/ESP32Health.js`** to **`/config/www/esp32health/ESP32Health.js`** on your Home Assistant installation.
2. Add a dashboard resource with URL **`/local/esp32health/ESP32Health.js?v=0.1.1`**, type **JavaScript module**.
3. Add a card of type **`custom:esp32health-card`**. You can use the visual card editor to discover/add devices and choose entities, then press **Save** in Home Assistant.

Minimal configuration:

```yaml
type: custom:esp32health-card
title: Dit hjem, i overblik
devices: []
```

For a full example, see [examples/lovelace.yaml](examples/lovelace.yaml). Use a panel view or a wide section for the complete dashboard. Narrow cards reflow to a single column.

The card uses Home Assistant's existing `hass` object, connection and permissions; it does **not** need another token. Changes in the normal **Enheder** tab are temporary inside HA. Persist them through **Edit dashboard → Edit card** and its visual editor, or download the card configuration and paste the JSON into the YAML editor (JSON is valid YAML). Changes made in the standalone app are saved locally in that browser and do not update your Lovelace dashboard.

This is a frontend card. It does not create new HA entities, install ESPHome firmware, or require a Python custom integration.

## Measurement handling

For current BHA2 vital estimates, the app requires presence, one estimated target, a distance of **0.5–1.5 metres**, positive heart/breath readings and recent numeric-state timestamps. The default timestamp limit is 180 seconds (`stale_after` in card config, minimum 30). Distances are converted from their explicit HA units, including ESPHome's default centimetres. Unknown units are not guessed.

HA may expose the time of the last **change**, not the last sensor **report**. Stable numeric readings can therefore be hidden conservatively. `last_reported` is used when available; otherwise `last_updated` is used. See [ESPHome entity fragments](examples/esphome-entities.yaml) for `force_update` options, which can increase Recorder storage use.

Timestamp checks cannot detect a radar that repeatedly publishes an old estimate. Stillness and signal quality are not available as verified metadata. Historical charts/CSV contain raw Recorder values, **not validated health observations**. A zero or unavailable value breaks a chart line. The app does not calculate sleep stages, diagnoses, ECG or oxygen saturation. It sends no emergency notifications; any notification automation must run separately in Home Assistant, including while this page is closed.

See [device notes and sources](docs/devices.md) for sensor limitations. ESP32Health is not medical equipment or a certified alarm system.

## Development

No package installation or bundler is required. Node.js 20+ runs the tests:

```sh
npm test
```

The single, self-contained card artifact is `dist/ESP32Health.js`. The standalone shell imports it alongside `ha-client.js` and `demo.js`. Home Assistant remains the source of truth and handles history retention. The app does not maintain another health database.

[Contributing](CONTRIBUTING.md) · [Security and privacy](SECURITY.md) · [MIT license](LICENSE)
