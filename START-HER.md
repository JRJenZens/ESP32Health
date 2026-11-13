# Kom i gang med ESP32Health

Første preview kan bruges på to måder. Begge læser fra Home Assistant, hvor dine ESPHome-enheder skal være tilføjet.

## Åbn webappen

Åbn en terminal i denne mappe, og kør:

```sh
python3 -m http.server 8320 --bind 127.0.0.1
```

Gå til **http://127.0.0.1:8320**. Vælg **Udforsk demo** for at se designet med opdigtede data.

For dine egne enheder vælger du **Tilslut Home Assistant**, indtaster adressen og et adgangstoken fra din Home Assistant-profil. Under **Enheder** kan du finde radarerne og kontrollere koblingen af puls, vejrtrækning, tilstedeværelse og faldsignal. Hvis modellen ikke findes automatisk, tilføjer du den manuelt.

Tokenet gemmes kun, mens siden er åben. Valg af enheder gemmes i denne browser. Webappen ændrer ikke din ESPHome-firmware eller Home Assistants indstillinger.

## Installér direkte fra GitHub i Home Assistant

[Åbn ESP32Health i Marketplace](https://my.home-assistant.io/redirect/marketplace_repository/?owner=JRJenZens&repository=ESP32Health&category=plugin)

Du kan installere og opdatere kortet gennem **Marketplace / HACS**. Tilføj repository `https://github.com/JRJenZens/ESP32Health` som typen **Dashboard**, download **v0.1.1** eller nyere, og genindlæs Home Assistant-siden. Tilføj derefter kortet **ESP32Health** på dit dashboard.

Se [trinvis dansk installationsvejledning](docs/installation-da.md).

## Manuel installation (alternativ)

1. Kopiér `dist/ESP32Health.js` til `/config/www/esp32health/ESP32Health.js` på Home Assistant.
2. Tilføj ressourcen `/local/esp32health/ESP32Health.js?v=0.1.1` som **JavaScript-modul** i dashboardets ressourcer.
3. Tilføj et kort med denne konfiguration:

```yaml
type: custom:esp32health-card
devices: []
```

4. Brug kortets visuelle editor til at finde/tilføje enheder og vælge entiteter. Tryk **Gem** i Home Assistant.

Kortet bruger dit eksisterende Home Assistant-login og kan også vises i Home Assistant-appen på iPhone/iPad. Det er lettest at bruge i en bred sektion eller en panelvisning.

## Hvad er afprøvet?

21 automatiserede testscenarier er bestået. Computer- og mobilvisning samt kortets API, faldadvarsel, afbrudt forbindelse og editorhændelse er kontrolleret med syntetiske data i browseren.

Tilslutning til dine fysiske radarer, installation i dit rigtige dashboard og installation gennem HACS mangler stadig at blive afprøvet. Historik kræver, at Recorder gemmer de valgte entiteter. ESP32Health viser sensorestimater og udsender ikke selv alarmnotifikationer.

Se [README](README.md) for flere detaljer og HACS-installation som brugerdefineret repository.
