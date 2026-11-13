# Installér ESP32Health fra GitHub i Home Assistant

ESP32Health installeres som et **dashboardkort** gennem **Marketplace / HACS**. Kortet bruger dit eksisterende Home Assistant-login og læser dine ESPHome-sensorer gennem Home Assistant.

## 1. Åbn ESP32Health

**[Åbn ESP32Health i Home Assistant Marketplace](https://my.home-assistant.io/redirect/marketplace_repository/?owner=JRJenZens&repository=ESP32Health&category=plugin)**

Hvis My Home Assistant spørger efter din Home Assistant-adresse, indtaster du den adresse, du normalt bruger. På ældre installationer kan du bruge [HACS-linket](https://my.home-assistant.io/redirect/hacs_repository/?owner=JRJenZens&repository=ESP32Health&category=plugin).

Hvis linket ikke åbner kortets side, tilføjer du repository manuelt:

1. Åbn **Marketplace / HACS** i Home Assistant.
2. Tryk på menuen med **tre prikker**.
3. Vælg **Brugerdefinerede repositories / Custom repositories**.
4. Indtast `https://github.com/JRJenZens/ESP32Health`.
5. Vælg typen **Dashboard**, og tryk **Tilføj**.
6. Find og åbn **ESP32Health**.

## 2. Download kortet

Tryk **Download**, vælg **v0.1.1** eller nyere, og gennemfør download. Versionen er udgivet som en almindelig GitHub-release, så betaversioner ikke skal aktiveres. Programmet er fortsat under udvikling.

Genindlæs Home Assistant-siden, når du bliver bedt om det. Det er normalt tilstrækkeligt at genindlæse browseren; selve Home Assistant-serveren behøver normalt ikke en genstart for et dashboardkort.

## 3. Tilføj kortet på dit dashboard

Åbn det ønskede dashboard, vælg **Rediger dashboard → Tilføj kort**, og find **ESP32Health**.

Hvis kortet ikke vises i listen, kan du vælge **Manuelt** og indsætte:

```yaml
type: custom:esp32health-card
title: Dit hjem, i overblik
devices: []
```

Brug kortets **visuelle editor** til at finde/tilføje enheder og vælge de rigtige entiteter. Tryk derefter **Gem** i Home Assistant. Kortets almindelige fane **Enheder** kan også bruges til afprøvning, men ændringer dér er midlertidige inde i Home Assistant.

Vælg en bred dashboardsektion eller panelvisning, hvis du vil have hele overblikket på én side. Kortet tilpasser sig også smalle sektioner.

## Hvis du ser “Custom element doesn't exist: esp32health-card”

Kontrollér dashboardets **Ressourcer**. Hvis Marketplace/HACS ikke har tilføjet ressourcen automatisk, tilføjer du:

- URL: `/hacsfiles/ESP32Health/ESP32Health.js`
- Type: **JavaScript-modul**

Genindlæs derefter browseren helt. Undgå at tilføje både en manuel `/local/`-kopi og HACS-kopien som ressourcer samtidig.

## Opdateringer

Nye udgivelser kan downloades gennem Marketplace/HACS. Efter opdatering genindlæser du Home Assistant-siden. Dit valg af enheder ligger i dashboardets kortkonfiguration.

## Forudsætninger og afprøvning

Marketplace/HACS skal være installeret. Sensorerne skal allerede være tilføjet til Home Assistant via ESPHome. Hvis de ikke findes automatisk, kan du vælge modellen og entiteterne manuelt. Historik kræver Recorder.

Pakkens struktur kontrolleres automatisk med HACS' officielle validator. Installation på brugerens konkrete Home Assistant og målinger fra fysiske radarer skal fortsat afprøves. Kortet viser sensorestimater og sender ikke selv alarmnotifikationer.
