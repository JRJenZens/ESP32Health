# 0.3.0

- Monitor med store tal og frekvensbaseret animation, tydeligt adskilt fra EKG.
- Vis puls og vejrtrækning uafhængigt, når den enkelte måling er brugbar.
- Forklaring af streger, rå frekvenser og opdateringstider under hver BHA2-radar.
- Valgfrie grænser, varighed, signaltab og faldsignaler med lokal hændelseslog.
- Alarmkontrol i backend, også når web-UI er lukket; alt er slået fra som standard.
- Beskeder til Home Assistant eller en valgt Companion-app gennem en afgrænset backendfunktion.
- Deduplikering, fem minutters beskedbegrænsning pr. regel og synlige afsendelsesfejl.
- Ingen medicinske standardgrænser. Manglende signal behandles aldrig som bekræftet vejrtrækningsstop.

# 0.2.1

- Vælg en fysisk ESPHome-enhed manuelt fra Home Assistants enhedsregister.
- Vælg radarmodel og gennemgå sensorforslag fra samme fysiske enhed.
- Genkend også radarer med generisk ESP32-modelnavn og danske sensornavne.
- Bevar eksisterende koblinger og undgå at tilføje samme radar flere gange.
- Kortere sensorlister og stabil opsætning under liveopdateringer.
- Vent med historik, indtil de nye sensorkoblinger er gemt.

# 0.2.0

- ESP32Health er nu en Home Assistant-app, som installeres under Apps ligesom ESPScripts.
- Automatisk intern forbindelse til Home Assistant og adgang gennem Ingress.
- Åbn web-UI og mulighed for genvej i sidepanelet.
- Central og vedvarende enhedsopsætning med beskyttelse mod overskrivning fra flere faner.
- MR60BHA2/MR60FDA2, livevisning, Recorder-historik og CSV-eksport i det rødlige design.
- Ingen manuelt indtastet serveradresse, ekstra adgangstoken eller dashboardressource.
- 0.1-dashboard- og standalone-installationen er erstattet. Vælg enhederne igen i appen.
