# ESP32Health til Home Assistant

**ESP32Health installeres som en app under Indstillinger → Apps i Home Assistant**, på samme måde som ESPScripts. Appen åbnes med **Åbn web-UI** og kan vises i sidepanelet.

[![Tilføj ESP32Health-app-repository](https://my.home-assistant.io/badges/supervisor_add_addon_repository.svg)](https://my.home-assistant.io/redirect/supervisor_add_addon_repository/?repository_url=https%3A%2F%2Fgithub.com%2FJRJenZens%2FESP32Health)

[**Tilføj repository i Home Assistant**](https://my.home-assistant.io/redirect/supervisor_add_addon_repository/?repository_url=https%3A%2F%2Fgithub.com%2FJRJenZens%2FESP32Health) · [Dansk installationsvejledning](esp32health/DOCS.md)

![ESP32Health — syntetiske testdata](docs/preview.png)

## Installation

1. Åbn linket ovenfor og tilføj repository. Alternativt: **Indstillinger → Apps → App-butik → ⋮ → Repositories**, og tilføj `https://github.com/JRJenZens/ESP32Health`.
2. Find **ESP32Health**, og vælg **Installér**. Første installation bygger appen og kan tage nogle minutter.
3. Vælg **Start** og derefter **Åbn web-UI**. Aktivér eventuelt **Vis i sidepanel**.
4. Gå til **Enheder** i ESP32Health, og vælg **Find Seeed-enheder**, eller vælg **Vælg ESPHome-enhed** for at forbinde en fysisk enhed manuelt.
5. Kontrollér entiteterne. Opsætningen gemmes automatisk i appen og bruges på tværs af dine enheder.

Kræver Home Assistant OS eller en Supervisor-installation med Apps. Sensorerne skal allerede være tilføjet til Home Assistant via ESPHome. Der skal ikke indtastes URL, adgangstoken eller opsættes et dashboardkort. Den aktuelle app retter sig mod HA-administratorer.

## Sensorer og funktioner

- **MR60BHA2:** radar-estimeret puls og vejrtrækning, tilstedeværelse, afstand, estimeret antal personer og eventuelt lysniveau.
- **MR60FDA2:** tilstedeværelse, aktuelt faldsignal og eventuelt lysniveau.
- Flere radarer med separate navne, områder og entitetskoblinger.
- Manuel liste over ESPHome-enheder og radarmodelvalg. Sensorvalg afgrænses til den valgte fysiske enhed; generiske ESP32-modelnavne og danske sensornavne understøttes.
- Liveopdateringer, automatisk genforbindelse og rådata med forklaring, når målinger mangler.
- Monitor med store tal og frekvensbaseret rytmeanimation, tydeligt mærket som illustration og ikke EKG.
- Valgfrie grænser for høj/lav puls og vejrtrækning, manglende signal og muligt fald. Beskeder til Home Assistant eller en valgt Companion-app.
- Recorder-historik for 1, 6, 12 eller 24 timer samt CSV-eksport.
- Bordeaux og rosa design, som tilpasser sig computer, iPhone og iPad.

Appen bruger Home Assistants interne API gennem Supervisor. Login og adgang til web-UI håndteres gennem Ingress. Opsætningen ligger i appens private `/data/config.json` og følger med en sikkerhedskopi af appen. Målehistorik bliver i Home Assistant Recorder; Appen gemmer en lokal log over de seneste 50 alarmhændelser i `/data/alerts.json`. [Teknisk dokumentation om Ingress](https://contributors.home-assistant.io/apps/guides/ingress/).

## Valgfrie alarmregler

Åbn **Alarmer**, vælg dine egne grænser, forsinkelse og beskedmodtager, markér **Slå alarmer til**, og tryk **Gem alarmindstillinger** for hver radar. Alt er slået fra ved installation; tomme grænser betyder ingen regel. Regler kører i appen, også når web-UI er lukket, men kræver en kørende app og Home Assistant. Grænser vurderes kun ved brugbare målinger. Signaltabsreglen dækker også nul, ingen person, forkert målezone og afbrudt forbindelse.

En betingelse skal vare hele forsinkelsen (5–600 sekunder). Der sendes én besked pr. hændelse og højst én pr. regel hvert femte minut. Forsinkelsen starter forfra efter genstart eller afbrydelse; allerede udløste hændelser deduplikeres efter genstart. Leveringsfejl eller uafklaret afsendelse vises i loggen og gentages ikke automatisk. En accepteret HA-handling bekræfter ikke levering til telefonen.

Appen er ikke en medicinsk alarm eller et nødopkaldssystem. Vælg grænser efter dit konkrete behov; der er ingen anbefalede medicinske standardgrænser.

## Overgang fra version 0.1

Fra **0.2.0** distribueres ESP32Health kun som Home Assistant-app. Hvis du har installeret dashboardkortet gennem Marketplace/HACS, kan du fjerne det gamle kort og dets ressource og afinstallere den gamle pakke. Tilføj derefter dette repository under **Apps**. Sensorerne i ESPHome/Home Assistant skal bevares.

Den nye app har sin egen centrale opsætning. Tidligere browser- eller kortopsætninger flyttes ikke automatisk; vælg enhederne igen i appen. Historik, der ligger i Recorder, bliver bevaret. De tidligere 0.1-udgivelser findes fortsat som versionshistorik på GitHub.

## Målingernes begrænsninger

Aktuelle BHA2-vitalestimater vises kun ved registreret tilstedeværelse, ét estimeret mål, afstand på 0,5–1,5 m og nylige positive tal. Afstand omregnes ud fra entitetens måleenhed, herunder ESPHomes standard cm. Nul, ukendte værdier, tvetydige målebetingelser og afbrudt forbindelse vises ikke som normale vitalværdier.

`last_reported` bruges, hvis det er tilgængeligt, ellers `last_updated`. Stabilt gentagne tal kan derfor blive skjult konservativt. `force_update` på de numeriske ESPHome-sensorer kan hjælpe med opdateringstider, men kan øge Recorder-skrivninger og beviser ikke, at radarens estimat er nyt. Se [ESPHome-fragmenter](examples/esphome-entities.yaml).

Sensorerne kan fastholde gamle estimater, og appen kan ikke bekræfte stilleståen eller signalets kvalitet. Historik og CSV viser rå Recorder-værdier. ESP32Health er ikke medicinsk udstyr eller et certificeret alarmsystem og kan sende vejledende beskeder efter dine egne regler. Manglende signal dokumenterer ikke vejrtrækningsstop. [Enhedsnoter og kilder](docs/devices.md).

## Udvikling og afprøvning

Backend: Python 3.13 og aiohttp. Frontend: almindelige JavaScript-moduler uden byggetrin. Runtime-pakken ligger under `esp32health/`; root `repository.yaml` gør den synlig i app-butikken.

```sh
python3 -m venv .venv
.venv/bin/pip install -r esp32health/requirements.txt
.venv/bin/python -m unittest discover -s tests -p 'test_*.py'
npm test
```

`npm test` kræver Node.js 20+. `tests/preview.py` er en udviklingsfixture med syntetiske data under en Ingress-lignende URL. Den tilgår ikke en rigtig HA-installation og er ikke med i containeren.

Versionen er fortsat under udvikling. Se [validering og kendte grænser](docs/validation.md). [Bidrag](CONTRIBUTING.md) · [Sikkerhed](SECURITY.md) · [MIT-licens](LICENSE).
