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

## Målebetingelser

MR60BHA2 skal have én person i ro og korrekt afstand. Appen kræver positive og nylige tal samt en estimeret afstand på 0,5–1,5 m for at vise aktuelle vitalestimater. Radaren kan fastholde et gammelt estimat; opdateringstid er ikke en garanti for målekvalitet.

MR60FDA2 skal være monteret og kalibreret korrekt i ESPHome/Home Assistant. Appen ændrer ikke højde, følsomhed, firmware eller andre fysiske indstillinger.

Notifikationer og alarmhandlinger opsættes særskilt i Home Assistant. Appen viser sensorestimater og er ikke medicinsk udstyr eller et certificeret alarmsystem.

## Opdatering og backup

Opdater via appens side i Home Assistant, når en ny version vises. Ved behov vælges **Søg efter opdateringer** i app-butikken. Opsætningen ligger i `/data/config.json` og følger med en backup af appen. Målehistorikken ligger fortsat i Home Assistant Recorder.

Fra den tidligere Marketplace/HACS-version: Fjern det gamle dashboardkort og dets ressource, og afinstallér den gamle pakke. Bevar ESPHome-enheder og sensorentiteter. Vælg radarerne igen i appen; de gamle koblinger flyttes ikke automatisk.
