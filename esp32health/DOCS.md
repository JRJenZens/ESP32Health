# ESP32Health — kom i gang

## Installér fra GitHub under Apps

1. Åbn **Indstillinger → Apps → App-butik** i Home Assistant.
2. Vælg **⋮ → Repositories** og tilføj `https://github.com/JRJenZens/ESP32Health`.
3. Find **ESP32Health**, og tryk **Installér**. Første installation bygger appen og kan tage nogle minutter.
4. Tryk **Start** og **Åbn web-UI**.
5. Slå eventuelt **Vis i sidepanel** og **Start ved opstart** til.

Appen kobler sig automatisk til den Home Assistant, den er installeret i. Du skal ikke oprette et ekstra adgangstoken eller angive en serveradresse.

## Tilføj dine radarer

Åbn **Enheder → Find Seeed-enheder**. Appen foreslår MR60BHA2/MR60FDA2-enheder, der kan genkendes i Home Assistants enhedsregister. Kontrollér forslagene og de valgte entiteter.

Hvis radaren ikke findes automatisk, vælg **Vælg ESPHome-enhed**. Vælg den fysiske enhed i listen, kontrollér radarmodellen, og tryk **Tilføj / forbind enhed**. Listen viser ESPHome-enheder, som er tilføjet til Home Assistant; enheder, der kun findes i ESPHome Builder, skal først tilføjes gennem integrationen ESPHome.

Appen foreslår sensorkoblinger fra netop den valgte enhed. Den genbruger en allerede tilføjet radar, så samme fysiske enhed ikke bliver tilføjet to gange. Du kan også bruge **+ MR60BHA2** eller **+ MR60FDA2** og vælge entiteterne helt manuelt. Brug separate enheder til hver fysisk radar. Nummeret af radarer med tilstedeværelse er ikke et persontal.

Opsætningen gemmes automatisk. Vent på **Opsætning gemt** øverst, før du lukker appen. Den samme opsætning bruges fra computer, mobil og tablet og overlever en genstart af appen.

Hvis en anden fane gemmer først, genindlæses den gemte opsætning. Foretag din ændring igen, så du ikke overskriver andre ændringer ved en fejl.

## Historik

Historikken kommer fra Home Assistant Recorder. Vælg en radar og en periode, og tryk **Opdatér**. Under **Historik** kan du eksportere rå sensorværdier som CSV og se aktive faldsignaler i den hentede periode.

Manglende historik kan skyldes, at entiteterne ikke gemmes af Recorder, eller at der ikke findes data i perioden. Det beviser ikke, at der ikke er sket et fald.

## Hvis forbindelsen er afbrudt

Appen forsøger selv at forbinde igen. Kontrollér, at Home Assistant og ESPHome-enhederne er tilgængelige. Ukendte eller utilgængelige sensorværdier vises som ukendte og bliver ikke omregnet til nul.

Hvis appen ikke starter, læs fanen **Log** på appens side. Et eventuelt problem med opbygning af containeren ses i installationsloggen. Inkludér ikke tokens eller personlige måledata i offentlige fejlrapporter.

## Monitor og fejlsøgning

Den mørke monitor viser estimerede frekvenser. Animationen følger frekvensen og er ikke EKG eller registrerede enkelte hjerteslag. Den stopper, når et signal ikke er brugbart. En brugbar puls kan vises, selv om vejrtrækningsmålingen mangler, og omvendt.

Åbn **Hvorfor vises der streger? · Sensorens rådata** under radaren. Her ses rå frekvenser, de valgte entiteter og deres opdateringstider. 0 fra radaren er ikke en bekræftet fysiologisk måling på nul. Ret en stabil radar mod en enkelt stillesiddende persons overkrop inden for 0,5–1,5 m. Ved stabile tal kan `force_update: true` hjælpe; brug eksempelvis `throttle: 5s` før timeout-filteret for at begrænse Recorder-skrivninger. Se YAML-fragmentet i repository.

## Målebetingelser

MR60BHA2 skal have én person i ro og korrekt afstand. Appen kræver positive og nylige tal samt en estimeret afstand på 0,5–1,5 m for at vise aktuelle vitalestimater. Radaren kan fastholde et gammelt estimat; opdateringstid er ikke en garanti for målekvalitet.

MR60FDA2 skal være monteret og kalibreret korrekt i ESPHome/Home Assistant. Appen ændrer ikke højde, følsomhed, firmware eller andre fysiske indstillinger.

Under **Alarmer** vælger du dine egne grænser og en varighed, beskedmodtager og **Slå alarmer til**. Tryk **Gem alarmindstillinger** for hver enhed og vent på **Opsætning gemt**. Tomme grænser er inaktive. Alle regler er slået fra, indtil du aktiverer dem. Modtagere er Home Assistants notifikationer eller en tilgængelig Companion-app.

Alarmkontrollen kører i appen, selv om browseren er lukket. Appen og Home Assistant skal være startet og tilgængelige; stop, opdatering, genstart eller strømsvigt giver et hul i kontrollen. Grænseregler kræver brugbare målebetingelser. Valgfrit signaltab omfatter også ingen person, nulmåling, forkert afstand og afbrudt forbindelse. Det er ikke en bekræftet vejrtrækningspause.

Forsinkelsen kan sættes til 5–600 sekunder og starter forfra ved afbrydelse eller genstart. Der sendes én besked pr. hændelse, højst én pr. regel hvert femte minut. Loggen viser op til 50 hændelser, herunder afsendelsesfejl og uafklaret levering efter afbrydelse. Der forsøges ikke automatisk igen ved fejl; kontrollér modtager og HA, og afprøv næste hændelse. Home Assistants accept er ikke en kvittering fra telefonen. Appen er ikke medicinsk udstyr eller et medicinsk alarmsystem.

## Opdatering og backup

Opdater via appens side i Home Assistant, når en ny version vises. Ved behov vælges **Søg efter opdateringer** i app-butikken. Opsætningen ligger i `/data/config.json`, den lokale alarmlog i `/data/alerts.json`, og begge følger med en backup af appen. Målehistorikken ligger fortsat i Home Assistant Recorder.

Fra den tidligere Marketplace/HACS-version: Fjern det gamle dashboardkort og dets ressource, og afinstallér den gamle pakke. Bevar ESPHome-enheder og sensorentiteter. Vælg radarerne igen i appen; de gamle koblinger flyttes ikke automatisk.
