# ESPHealth — kom i gang

## Installér fra GitHub under Apps

1. Åbn **Indstillinger → Apps → App-butik** i Home Assistant.
2. Vælg **⋮ → Repositories** og tilføj `https://github.com/JRJenZens/ESP32Health`.
3. Find **ESPHealth**, og tryk **Installér**. Første installation bygger appen og kan tage nogle minutter.
4. Tryk **Start** og **Åbn web-UI**.
5. Slå eventuelt **Vis i sidepanel** og **Start ved opstart** til.

Appen kobler sig automatisk til den Home Assistant, den er installeret i. Du skal ikke oprette et ekstra adgangstoken eller angive en serveradresse.

## Tilføj dine radarer

Åbn **Enheder → Find Seeed-enheder**. Appen foreslår MR60BHA2/MR60FDA2-enheder, der kan genkendes i Home Assistants enhedsregister. Kontrollér forslagene og de valgte entiteter.

Hvis radaren ikke findes automatisk, vælg **Vælg ESPHome-enhed**. Vælg den fysiske enhed i listen, kontrollér radarmodellen, og tryk **Tilføj / forbind enhed**. Listen viser ESPHome-enheder, som er tilføjet til Home Assistant; enheder, der kun findes i ESPHome Builder, skal først tilføjes gennem integrationen ESPHome.

Appen foreslår sensorkoblinger fra netop den valgte enhed. Den genbruger en allerede tilføjet radar, så samme fysiske enhed ikke bliver tilføjet to gange. Du kan også bruge **+ MR60BHA2** eller **+ MR60FDA2** og vælge entiteterne helt manuelt. Brug separate enheder til hver fysisk radar. Nummeret af radarer med tilstedeværelse er ikke et persontal.

Opsætningen gemmes automatisk. Vent på **Opsætning gemt** øverst, før du lukker appen. Den samme opsætning bruges fra computer, mobil og tablet og overlever en genstart af appen.

Hvis en anden fane gemmer først, genindlæses den gemte opsætning. Foretag din ændring igen, så du ikke overskriver andre ændringer ved en fejl.

## Status-LED

Installér status-LED-opsætningen fra repositoryets `examples/esphealth-status-led.yaml` i ESPHome på hver radar. Bevar de eksisterende sensor-, netværks- og LED-definitioner, og flet lister i stedet for at oprette dublerede YAML-nøgler. Fragmentet bruger IDs `rgb_led` og `radar_presence` og skal valideres og bygges før installation.

Åbn **Enheder**, vælg **ESPHealth LED status** under den rette radar, markér **Brug radarens LED til ESPHealth-status**, og tryk **Gem LED-indstillinger**. Listen er begrænset til samme fysiske enhed. Slå valget fra og gem for at deaktivere statusvisningen.

- Svagt grønt: en person er registreret. Det er ikke en vurdering af sundhed.
- Gult blink: almindelig alarm er aktiv.
- Rødt blink: kritisk alarm er aktiv og har prioritet over gul.
- Blåt blink: radaren har ikke modtaget status fra HA/ESPHealth i 45 sekunder.
- Slukket: ingen person, eller status-LED er deaktiveret.

Appen sender en statusopdatering hvert 15. sekund; radaren styrer selv farver, blink, tilstedeværelse og forbindelsestimeout. LED-farverne følger aktive alarmregler, ikke en endnu afventende timer. Ved stop eller opdatering af appen kan blåt vise manglende opdateringer. En firmwaregenstart afventer friske opdateringer frem for at genoptage en gammel alarmfarve.

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

På **Alarmer** står indstillingerne først og alarmstatus samt seneste hændelser nederst.

Under **Alarmer** kan hver BHA2-radar få separate grænser for **Puls** og **Vejrtrækning**, både **Under grænsen** og **Over grænsen**.

- **Alarm:** vælg en grænse og hvor mange sammenhængende sekunder den skal være overskredet. Der sendes en almindelig besked.
- **Kritisk alarm:** vælg en kritisk grænse og en separat varighed. Der sendes en kritisk besked til en valgt Companion-modtager.

Tomme grænser er slået fra. Varigheder kan være 1–3600 sekunder. Kritisk lavgrænse må ikke være højere end alarmens lavgrænse; kritisk højgrænse må ikke være lavere end alarmens højgrænse. Samme grænse kan bruges med forskellige varigheder.

Markér **Slå alarmer til**, og tryk **Gem alarmindstillinger** for hver radar. Vent på **Opsætning gemt**. Der er ingen medicinske standardgrænser eller automatisk aktivering.

En grænse skal være overskredet i hele sin valgte periode. En normal måling eller tab af brugbar måling nulstiller den pågældende timer. Statusfeltet viser den aktuelle ventetid. Timerne er uafhængige, så en kritisk alarm kan udløses efter sin egen varighed, selv om en almindelig alarm netop er sendt. Udløses begge samtidig, sendes kun kritisk. En almindelig besked for samme betingelse udelades, mens den kritiske alarm er aktiv; ved nedtrapning kan den almindelige grænse igen blive aktiv.

**Signaltab** og FDA2-**Faldsignal** har egen varighed og et valg af beskedtype. Signaltab omfatter også ingen person, nulmåling, forkert afstand og afbrudt forbindelse. Det er ikke en bekræftet vejrtrækningspause.

Kritiske beskeder på iPhone/iPad kræver tilladelse til kritiske advarsler i Home Assistants notifikationsindstillinger og kan da afspille lyd trods lydløs tilstand og Fokus. Android-alarmkanaler opsættes ikke af denne app. [Officiel vejledning](https://companion.home-assistant.io/docs/notifications/critical-notifications/).

**Send testbesked** og **Send kritisk testbesked** afprøver modtageren uden at ændre eller aktivere regler. De bruger samme afsendelse som alarmerne, gemmes i loggen og kan højst sendes hvert 10. sekund. Kontrollér på telefonen, at beskeden vises og eventuelt afspiller lyd. En HA-accept er ikke en kvittering fra telefonen.

Kontrollér ved manglende telefonbesked, at modtageren er den aktuelle telefon, og at Home Assistant-appen har notifikationstilladelse, lyde og eventuelt kritiske advarsler. En gammel Companion-registrering kan fortsat findes som service uden at modtage push.

Der sendes én besked pr. hændelse, højst én pr. betingelse og niveau hvert femte minut. Kritisk eskalering blokeres ikke af en almindelig besked. Loggen viser op til 50 hændelser og afsendelsesfejl. Der forsøges ikke automatisk igen ved fejl; kontrollér HA og modtageren og afprøv næste hændelse.

Alarmkontrollen kræver, at appen og Home Assistant kører. Stop, opdatering, genstart eller strømsvigt giver et hul i kontrollen; afventende perioder begynder forfra. Appen er ikke medicinsk udstyr eller et medicinsk alarmsystem.

Tidligere grænser fra 0.3 overføres med samme værdi, tid, modtager og aktivering til det tilsvarende almindelige eller kritiske niveau. Ingen nye grænser vælges automatisk. Gennemgå felterne efter opdateringen. Gendan en fuld backup af tidligere version og opsætning, hvis du ruller tilbage til 0.3.

## Opdatering og backup

Eksisterende ESP32Health-installationer opdateres til navnet **ESPHealth** gennem den samme app, og opsætningen følger med.

Opdater via appens side i Home Assistant, når en ny version vises. Ved behov vælges **Søg efter opdateringer** i app-butikken. Opsætningen ligger i `/data/config.json`, den lokale alarmlog i `/data/alerts.json`, og begge følger med en backup af appen. Målehistorikken ligger fortsat i Home Assistant Recorder.

Fra den tidligere Marketplace/HACS-version: Fjern det gamle dashboardkort og dets ressource, og afinstallér den gamle pakke. Bevar ESPHome-enheder og sensorentiteter. Vælg radarerne igen i appen; de gamle koblinger flyttes ikke automatisk.
