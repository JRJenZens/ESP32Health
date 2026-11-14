# Device scope and sources

The Home Assistant app assumes both kits already run ESPHome and are added to Home Assistant. It does not communicate with the radar UART or change device firmware.

| Model | ESPHome component | Data used |
| --- | --- | --- |
| MR60BHA2 | `seeed_mr60bha2` | `has_target`, `heart_rate`, `breath_rate`, `distance`, `num_targets` |
| MR60FDA2 | `seeed_mr60fda2` | `people_exist`, `fall_detected` |
| Both kits, optional | `bh1750` | Illuminance, if exposed to HA |

FDA2 installation height, sensitivity and height threshold affect detection. Configure these in ESPHome/Home Assistant according to the physical installation. This preview displays sensor data and does not write calibration settings or factory-reset devices.

BHA2 vital estimates require one still person and a stable radar. Seeed documents a core zone of 0.5–1.5 m. A radar can hold the last estimate when the target leaves its effective range; non-zero heart estimates may also occur from interference. Its estimated target count is experimental. Consequently, ESPHealth checks the available conditions but cannot verify the observation. Two radars detecting presence do not imply two different people.

The default ESPHome BHA2 distance unit is **cm**, not m. The display converts using the entity's `unit_of_measurement`. Never set a distance conversion by guessing the entity name.

## Primary references

- [Seeed MR60FDA2 kit](https://wiki.seeedstudio.com/getting_started_with_mr60fda2_mmwave_kit/)
- [Seeed MR60BHA2 kit](https://wiki.seeedstudio.com/getting_started_with_mr60bha2_mmwave_kit/)
- [Seeed BHA2 reporting behavior](https://wiki.seeedstudio.com/ha_with_mr60bha2/#troubleshooting)
- [ESPHome MR60BHA2](https://esphome.io/components/seeed_mr60bha2/)
- [ESPHome MR60FDA2](https://esphome.io/components/seeed_mr60fda2/)
- [ESPHome BHA2 sensor schema and units](https://github.com/esphome/esphome/blob/dev/esphome/components/seeed_mr60bha2/sensor.py)
- [Home Assistant WebSocket API](https://developers.home-assistant.io/docs/api/websocket/)
- [Home Assistant history WebSocket implementation](https://github.com/home-assistant/core/blob/dev/homeassistant/components/history/websocket_api.py)
- [Home Assistant custom card API](https://developers.home-assistant.io/docs/frontend/custom-ui/custom-card/)
- [HACS dashboard packaging](https://www.hacs.xyz/docs/publish/plugin/)

Verified against the public documentation during development in November 2026. Hardware and firmware variants still require device testing.
