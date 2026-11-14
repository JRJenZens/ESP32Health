# 0.5.1

- GitHub-repository og installationslinks er flyttet til JRJenZens/ESPHealth.
- Lokal backup og import til en ny, tom installation bevarer sensorkoblinger, alarmgrænser, LED-valg og alarmlog.
- Aktive alarmers gentagelsesbeskyttelse bevares; ventende tidsperioder starter forfra.
- Reguler LED-lysstyrke fra 0–100 % separat for hver radar. Indstillingen gemmes lokalt og gælder også ved forbindelsestab.
- Kræver det opdaterede ESPHome-fragment med ESPHealth LED lysstyrke. Appens rettigheder er uændrede.

# 0.5.0

- Appen hedder nu ESPHealth i Home Assistant, brugerflade, beskeder og dokumentation.
- Alarmstatus og seneste hændelser er flyttet ned under indstillingerne.
- Status-LED kan forbindes og aktiveres separat for hver radar under Enheder.
- Svagt grønt ved tilstedeværelse, gult blink ved almindelig alarm og rødt blink ved kritisk alarm.
- Lokal watchdog giver blåt blink efter 45 sekunder uden opdatering fra HA/ESPHealth.
- Afgrænset LED-styring med fysisk enhedstjek og fire faste tilstande.
- ESPHome-fragment til de eksisterende RGB-LED- og tilstedeværelseskomponenter.
- Eksisterende sensor- og alarmindstillinger bevares ved opdatering.

# 0.4.0

- Separate alarm- og kritiske grænser for høj/lav puls og vejrtrækning.
- Egen sammenhængende varighed i sekunder for hver grænse og hvert niveau.
- Vis løbende ventetid uden at afbryde redigering af formularen.
- Nulstil den relevante timer ved normal eller utilgængelig måling.
- Kritisk eskalering blokeres ikke af en tidligere almindelig alarm; udelad samtidig almindelig besked, mens kritisk er aktiv.
- Separate testknapper til almindelig og kritisk besked.
- Bevar hidtidige grænser, varighed, prioritet, modtager og aktivering ved opdatering.
- Ingen nye medicinske standardgrænser eller automatisk aktivering.

# 0.3.1

- Vælg almindelig eller kritisk besked pr. radar. Almindelig er standard.
- Kritisk lyd og prioritet til iPhone/iPad gennem Home Assistant Companion.
- Angiv standardlyd eksplicit for almindelige telefonbeskeder.
- Send en tydeligt markeret testbesked med valgt modtager og beskedtype, også mens alarmregler er slået fra.
- Testen bruger samme afsendelse som alarmerne og gemmer resultatet i den lokale log.
- Testbeskeder kan højst sendes hvert 10. sekund og ændrer ikke alarmgrænser eller aktivering.
- Bevar begrænsningen på én alarmbesked pr. regel hvert femte minut ved ændring af indstillinger.
- Vis almindelig/kritisk besked i nye loghændelser. Kritiske advarsler kræver tilladelse på iPhone/iPad.

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

- ESPHealth er nu en Home Assistant-app, som installeres under Apps ligesom ESPScripts.
- Automatisk intern forbindelse til Home Assistant og adgang gennem Ingress.
- Åbn web-UI og mulighed for genvej i sidepanelet.
- Central og vedvarende enhedsopsætning med beskyttelse mod overskrivning fra flere faner.
- MR60BHA2/MR60FDA2, livevisning, Recorder-historik og CSV-eksport i det rødlige design.
- Ingen manuelt indtastet serveradresse, ekstra adgangstoken eller dashboardressource.
- 0.1-dashboard- og standalone-installationen er erstattet. Vælg enhederne igen i appen.
