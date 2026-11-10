# SPEED CLUB — Store-Readiness (App Store + Google Play)

> Stand: 9. November 2026 (M3.9). Checkliste für den Store-Start von Version **1.0.0**. Texte auf Deutsch für den Owner; Store-Texte in **Deutsch und Englisch**, weil beide Stores pro Sprache eine eigene Fassung erwarten. Alles hier ist aus dem tatsächlichen Verhalten der App abgeleitet (Code, `docs/08_LEGAL_COMPLIANCE.md`, Datenschutzerklärung-Entwurf `web/database/data/legal/privacy.de.md`, ADR-029: keine Analyse- und Werbe-SDKs). **Keine Rechtsberatung:** Datenschutz-Angaben und Altersfreigabe prüft die Rechtsberatung zusammen mit der Datenschutzerklärung (OA-10, OA-17).
> Technische Schritte für iOS: `docs/IOS_TESTFLIGHT.md`. Server: `docs/DEPLOY.md`.

## 1. Stammdaten

| Feld | App Store Connect | Google Play Console |
|---|---|---|
| App-Name | SPEED CLUB (max. 30 Zeichen) | SPEED CLUB (max. 30 Zeichen) |
| Bundle-ID / Paketname | `de.speedclub.app` | `de.speedclub.app` |
| Version | 1.0.0, Build = `versionCode` aus `mobile/version.json` | 1.0.0, `versionCode` aus `mobile/version.json` (AAB, nicht APK) |
| Primärsprache | Deutsch | Deutsch (Deutschland), zusätzlich Englisch (USA oder UK) |
| Kategorie | Primär **Soziale Netze**, sekundär **Lifestyle** | **Auto & Fahrzeuge** (Alternative: Soziale Netzwerke; Owner entscheidet) |
| Preis | kostenlos, keine In-App-Käufe | kostenlos, keine In-App-Käufe, **keine Werbung** |
| Datenschutz-URL | `https://<domain>/datenschutz` | `https://<domain>/datenschutz` |
| Support-URL | `https://<domain>/kontakt` | E-Mail: Support-Adresse (`SUPPORT_EMAIL`), Website `https://<domain>` |
| Konto-Löschung (Web) | — (In-App-Löschung reicht, 5.1.1(v)) | `https://<domain>/konto-loeschen` (Pflichtfeld im Data-Safety-Formular) |
| Geräte | nur iPhone (`supportsTablet: false`) | Telefone; Tablets laufen, sind aber nicht gezielt optimiert |

## 2. Screenshots

**Quelle:** die Flagship-Screens aus `docs/03_DESIGN_SYSTEM.md` §13, mit echten Inhalten (Demo-Daten aus `DemoSeeder`, Fotos mit Lizenz aus `design/seed-photos/CREDITS.md`; vor der Nutzung prüfen, dass die Lizenz Werbung im Store erlaubt, sonst eigene Fotos des Kunden). Keine erfundenen Zahlen, keine Platzhalter, Theme **Carbon**, Sprache je Store-Fassung DE bzw. EN. Am besten vom echten Gerät oder Simulator/Emulator mit Release-Build; Ersatz: die Visual-Matrix der Web-App in der passenden Viewport-Größe (gleiche Oberfläche, aber ohne native Statusleiste — dann Statusleiste einheitlich nachbauen oder weglassen).

| # | Screen | Route | Aussage (Bildunterschrift DE / EN, optional) |
|---|---|---|---|
| 1 | FS-3 Fahrzeugprofil | VEH-01 | „Dein Build. Jedes Detail.“ / "Your build. Every detail." |
| 2 | FS-9 QR-Code | QR-02 | „Ein Scan vom Parkplatz zu deinem Build.“ / "One scan from the car park to your build." |
| 3 | FS-10 Öffentliche Fahrzeugseite (Handy) | WEB-01 | „Ohne App zu öffnen, mit App noch besser.“ / "Opens without the app, better with it." |
| 4 | FS-4 Garage | GAR-01 | „Alle deine Autos an einem Ort.“ / "All your cars in one place." |
| 5 | FS-6 Mod-Editor Räder & Reifen | GAR-10 | „Mods strukturiert dokumentieren.“ / "Document mods properly." |
| 6 | FS-11 Entdecken + Ergebnisse | DISC-01/02 | „Finde Builds nach Marke, Modell und Mods.“ / "Find builds by make, model and mods." |
| 7 | FS-2 Start | HOME-01 | „Neue Builds aus der Szene.“ / "Fresh builds from the scene." |
| 8 | FS-7 Unterhaltung | MSG-02 | „Direkt mit dem Besitzer schreiben.“ / "Message the owner directly." |
| 9 | FS-8 Profil | PROF-02 | (nur App Store) |
| 10 | FS-1 Willkommen | AUTH-02 | (nur App Store; Markenmoment) |

**Größen:**

| Store | Pflicht | Format | Aufnahme |
|---|---|---|---|
| App Store, iPhone 6,9″ | ja, 3–10 Bilder pro Sprache | **1290 × 2796** px (oder 1320 × 2868), PNG/JPEG, ohne Transparenz | Viewport 430 × 932 bei 3× |
| App Store, iPhone 6,5″ | nur wenn gewünscht (sonst skaliert Apple 6,9″) | 1284 × 2778 oder 1242 × 2688 | — |
| Google Play, Telefon | ja, 2–8 Bilder pro Sprache; für die Empfehlungsflächen mind. 4 Bilder ≥ 1080 px | **1080 × 1920** px (9:16; die lange Seite darf höchstens doppelt so lang sein wie die kurze, 1290 × 2796 ist deshalb **nicht** zulässig) | Viewport 360 × 640 bei 3× |
| Google Play, Feature-Grafik | ja | **1024 × 500** px, JPEG oder 24-Bit-PNG ohne Transparenz | eigenes Motiv: Nachtfoto + Logo (Markenmoment, `03` §11) |
| Google Play, App-Symbol | ja | **512 × 512** px, 32-Bit-PNG | aus `design/brand/` (App-Icon 1024) |
| App Store, App-Symbol | — | kommt aus dem Build (1024 × 1024) | — |

Ablage: `docs/reports/store/<store>/<sprache>/<nr>-<route>.png` (nicht in `releases/`).

## 3. Store-Texte (Entwurf)

### Deutsch

- **Untertitel (App Store, max. 30):** `Garage, Mods & QR fürs Auto` (27)
- **Kurzbeschreibung (Google Play, max. 80):** `Deine Garage, deine Mods, dein QR-Code – vom Parkplatz direkt zu deinem Build.` (78)
- **Werbetext (App Store, max. 170):** `Dokumentiere dein Auto mit Technik und Mods, hol dir deinen QR-Sticker und zeig deinen Build allen, die vor deinem Auto stehen bleiben.`
- **Beschreibung (max. 4000):**

```
SPEED CLUB ist die Community für Autoliebhaber in Deutschland. Hier zeigst du dein Auto so, wie es wirklich ist: mit Technik, Mods und Geschichte.

DEINE GARAGE
Leg deine Fahrzeuge mit Marke, Modell, Generation und Baujahr an. Trag Motor, Leistung, Drehmoment und Antrieb ein und lade deine besten Fotos hoch. Entwürfe werden gespeichert, du machst weiter, wann du willst.

MODS, DIE MAN VERSTEHT
Räder und Reifen, Fahrwerk, Abgasanlage, Motor und Leistung, Bremsen, Aero und Karosserie, Innenraum: Jede Modifikation hat die Felder, die wirklich zählen – von Einpresstiefe bis Reifengröße. Teilemarken kommen aus einem Katalog, Kosten zeigst du nur, wenn du willst.

DEIN QR-CODE
Jedes veröffentlichte Fahrzeug bekommt einen eigenen QR-Code. Als Sticker am Auto führt er jeden, der ihn scannt, direkt zu deinem Build – auch ohne App. Du siehst, wie oft er gescannt wurde, und kannst ihn jederzeit ersetzen. Wo ein Sticker am Auto hin darf, erklärt dir die App.

ENTDECKEN
Finde Builds nach Marke, Modell, Felgen, Fahrwerk oder Leistung. Folge Mitgliedern, merk dir Fahrzeuge und sieh auf der Startseite neue Builds und Updates aus der Szene.

NACHRICHTEN
Schreib Besitzern direkt, schick Fotos oder ein Fahrzeug. Wer dir noch nicht folgt, landet erst in den Anfragen.

SICHER UND FAIR
Melden und Blockieren gibt es überall. Ein Team prüft Meldungen, Entscheidungen werden begründet, und du kannst widersprechen. Kennzeichen kannst du unkenntlich machen, Standortdaten werden aus Fotos entfernt. Keine Werbung, keine Tracking-Dienste.

DEIN STIL
Drei Designs (Carbon, Schwarz, Hell), Deutsch und Englisch, PS oder kW.

SPEED CLUB macht keine Aussagen zur rechtlichen Zulässigkeit von Umbauten. Illegale Rennen haben bei uns keinen Platz.

Mindestalter: 16 Jahre.
```

### English

- **Subtitle (App Store, max. 30):** `Garage, mods & QR for your car` (30)
- **Short description (Google Play, max. 80):** `Your garage, your mods, your QR code – from the car park straight to your build.` (80)
- **Promotional text (App Store, max. 170):** `Document your car with specs and mods, get your QR sticker and show your build to everyone who stops next to your car.`
- **Description (max. 4000):**

```
SPEED CLUB is the community for car enthusiasts in Germany. Show your car the way it really is: specs, mods and its story.

YOUR GARAGE
Add your cars with make, model, generation and year. Enter engine, power, torque and drivetrain, and upload your best photos. Drafts are saved, so you can continue whenever you like.

MODS THAT MAKE SENSE
Wheels and tyres, suspension, exhaust, engine and performance, brakes, aero and body, interior: every modification has the fields that matter – from wheel offset to tyre size. Part brands come from a catalogue, and costs are shown only if you want.

YOUR QR CODE
Every published car gets its own QR code. As a sticker on your car it takes anyone who scans it straight to your build – no app needed. See how often it was scanned and replace it at any time. The app explains where a sticker may go on a car.

DISCOVER
Find builds by make, model, wheels, suspension or power. Follow members, save cars, and see new builds and updates from the scene on Home.

MESSAGES
Message owners directly, send photos or a car. People you don't follow land in requests first.

SAFE AND FAIR
Report and block are everywhere. A team reviews reports, decisions come with reasons, and you can appeal. You can blur number plates, and location data is removed from photos. No ads, no tracking.

YOUR STYLE
Three themes (Carbon, Black, Light), German and English, hp or kW.

SPEED CLUB never states whether a modification is road legal. Illegal street racing has no place here.

Minimum age: 16.
```

> Vor dem Einreichen prüfen: Jede Funktion in der Beschreibung muss im eingereichten Build aktiv sein. „Kennzeichen unkenntlich machen“ (Signature-Feature, M2.7) und die Mod-Kategorien gegen den Build prüfen; KI-Funktionen werden **nicht** beworben, solange sie aus sind (OA-18).

### Keywords (App Store, max. 100 Zeichen, Komma ohne Leerzeichen, Name und Kategorie nicht wiederholen)

- DE: `Auto,Tuning,Garage,Mods,Community,JDM,QR,Felgen,Fahrwerk,Car Meet,Build,Sportwagen,Oldtimer` (91)
- EN: `car,tuning,garage,mods,community,JDM,QR,wheels,suspension,car meet,build,sports car,stance` (90)

Google Play hat kein Keyword-Feld; die Begriffe stehen in der Beschreibung.

## 4. Altersfreigabe

Die AGB verlangen **16 Jahre** (Bestätigung bei der Registrierung, kein Geburtsdatum, `08` §1). Die Freigabe der Stores muss dazu passen.

**App Store (Fragebogen in App Store Connect → App-Informationen → Altersfreigabe):**

| Frage | Antwort | Grund |
|---|---|---|
| Gewalt (Cartoon, realistisch, grafisch) | Keine | keine Inhalte dieser Art; Community-Richtlinien verbieten Gewalt |
| Sexuelle Inhalte, Nacktheit | Keine | verboten (Community-Richtlinien 4) |
| Vulgäre Sprache, grober Humor | Keine | keine eigenen Inhalte dieser Art |
| Alkohol, Tabak, Drogen | Keine | — |
| Glücksspiel, simuliertes Glücksspiel, Wettbewerbe | Keine | — |
| Horror, Angst | Keine | — |
| Medizinische Informationen | Keine | — |
| Uneingeschränkter Webzugang | Nein | In-App-Browser nur für eigene Domain (QR-04) |
| Nutzergenerierte Inhalte | **Ja** | Fahrzeuge, Fotos, Texte, Profile |
| Nachrichten / Chat | **Ja** | Direktnachrichten zwischen Mitgliedern |
| Werbung | Nein | — |
| Altersprüfung / Kindersicherung im Produkt | Selbstauskunft 16+ bei der Registrierung | — |

Ergebnis: Apple vergibt die Stufe aus den Antworten; liegt sie unter 16+, **höhere Altersstufe manuell wählen (16+)**, damit sie zu den AGB passt. Endgültige Werte beim Ausfüllen im aktuellen Fragebogen prüfen.

**Google Play (IARC-Fragebogen, Kategorie „Soziales Netzwerk / Kommunikation“ bzw. „Alle anderen App-Typen“):** keine Gewalt, keine Sexualität, keine Schimpfwörter, keine Drogen, kein Glücksspiel; **Nutzer interagieren: ja**, **Nutzer teilen Inhalte: ja**, **genauer Standort wird geteilt: nein**, **digitale Käufe: nein**. Unter „Zielgruppe und Inhalte“: Altersgruppen **16–17 und 18+**, App richtet sich **nicht** an Kinder (damit gelten die Families-Richtlinien nicht).

## 5. Google Play: Data-Safety-Formular

Grundlage: was die App an den Server (oder über ihn an Dienstleister) überträgt. Daten nur auf dem Gerät (letzte Suchen, Offline-Cache, Upload-Warteschlange, Theme) gelten nicht als erhoben. Übermittlungen an Auftragsverarbeiter (Hoster, E-Mail, Expo/FCM/APNs für Push, Pusher, optional KI-Anbieter) gelten nach Play-Definition **nicht als Weitergabe**; öffentlich sichtbare Inhalte, die das Mitglied selbst veröffentlicht, ebenfalls nicht.

**Allgemeine Fragen**

| Frage | Antwort |
|---|---|
| Erhebt oder teilt die App Nutzerdaten? | Ja (erhebt), teilt nicht |
| Werden alle Daten bei der Übertragung verschlüsselt? | **Ja** (Staging/Produktion nur HTTPS; nur LAN-Testbuilds erlauben HTTP und gehen nie in den Store) |
| Können Nutzer die Löschung ihrer Daten anfordern? | **Ja**: in der App (Einstellungen → Konto → Konto löschen) und unter `https://<domain>/konto-loeschen` |
| Unabhängige Sicherheitsprüfung (MASA) | Nein |

**Erhobene Datentypen**

| Play-Datentyp | Erhoben | Pflicht/optional | Zwecke | Was genau |
|---|---|---|---|---|
| Persönliche Daten → E-Mail-Adresse | ja | Pflicht | App-Funktionalität, Kontoverwaltung, Betrugsprävention/Sicherheit, Entwickler-Kommunikation | Anmeldung, Codes, Sicherheits-Mails, Support |
| Persönliche Daten → Name | ja | optional | App-Funktionalität | Anzeigename im Profil |
| Persönliche Daten → Nutzer-IDs | ja | Pflicht | App-Funktionalität, Kontoverwaltung | Benutzername, Konto-ID |
| Persönliche Daten → Sonstige Daten | ja | optional | App-Funktionalität | Stadt (Freitext), Kurzbeschreibung, Bestätigung 16+ |
| Fotos und Videos → Fotos | ja | optional | App-Funktionalität | Fahrzeug-, Profil- und Chat-Fotos (Metadaten/GPS entfernt) |
| Nachrichten → Sonstige In-App-Nachrichten | ja | optional | App-Funktionalität | Direktnachrichten; Support-Anfragen |
| App-Aktivitäten → App-Interaktionen | ja | optional | App-Funktionalität | Folgen, Merken, Blockieren, Meldungen |
| App-Aktivitäten → Suchverlauf in der App | ja | optional | App-Funktionalität | Suchanfragen werden zur Suche an den Server gesendet (nicht gespeichert, außer in Server-Protokollen bis 14 Tage) |
| App-Aktivitäten → Sonstige nutzergenerierte Inhalte | ja | optional | App-Funktionalität | Fahrzeuge, technische Daten, Mods (auch Kosten, wenn eingetragen), Beschreibungen, Build-Updates |
| Geräte- oder andere IDs | ja | optional | App-Funktionalität | Push-Token (nur wenn Mitteilungen erlaubt), Gerätename/Plattform/App-Version in „Geräte & Sitzungen“ |
| Standort (ungefähr/genau) | **nein** | — | — | kein GPS, Stadt ist Freitext (siehe oben) |
| Finanzdaten, Gesundheit, Kontakte, Kalender, Audio, Dateien, Web-Browsing | **nein** | — | — | — |
| App-Informationen und -Leistung (Absturzberichte, Diagnose) | **nein** | — | — | kein Crash-SDK in der App. **Falls** später Sentry o. Ä. in die App kommt, hier nachtragen |
| Werbe-ID | **nein** | — | — | keine Werbe- oder Analyse-SDKs (ADR-029) |

Wenn KI-Funktionen eingeschaltet werden (OA-18): Inhalte, die das Mitglied für eine KI-Funktion auslöst (Suchtext, Mod-Angaben, Fotos beim Vorschlag), gehen an den KI-Anbieter als Auftragsverarbeiter: keine neue Datenkategorie, aber Datenschutzerklärung §7/§8 und ggf. das Formular erneut prüfen.

## 6. App Store: App-Datenschutz („Privacy Nutrition Label“)

**Tracking:** Nein. Die App verknüpft keine Daten mit Daten Dritter zu Werbezwecken und gibt keine an Datenhändler. Kein App-Tracking-Transparency-Dialog nötig.

**Mit dir verknüpfte Daten** (Zweck jeweils **App-Funktionalität**; nichts davon dient Werbung, Analyse oder Personalisierung durch Dritte):

| Apple-Kategorie | Datentyp | Erhoben |
|---|---|---|
| Kontaktinformationen | E-Mail-Adresse | ja |
| Kontaktinformationen | Name | ja (Anzeigename, optional) |
| Nutzerinhalte | Fotos oder Videos | ja |
| Nutzerinhalte | E-Mails oder Textnachrichten | ja (Direktnachrichten) |
| Nutzerinhalte | Kundensupport | ja (Support-Anfragen) |
| Nutzerinhalte | Andere Nutzerinhalte | ja (Fahrzeuge, Mods, Beschreibungen, Profiltexte) |
| Identifikatoren | Nutzer-ID | ja (Konto-ID, Benutzername) |
| Suchverlauf | Suchverlauf | ja (Suchanfragen an den Server) |
| Nutzungsdaten | Produktinteraktion | **nein**: es gibt nur anonyme Tageszähler ohne Personenbezug (ADR-216) |
| Diagnose | Absturzdaten, Leistungsdaten | **nein** |
| Standort | genau / ungefähr | **nein** |
| Identifikatoren | Geräte-ID | **nein** (keine Werbe- oder Geräte-ID; der Push-Token dient nur der Zustellung) |
| Finanzinfos, Gesundheit, Kontakte, Browserverlauf, Sensible Infos | — | **nein** |

**Nicht mit dir verknüpfte Daten:** keine (QR-Scans werden nur als Tageszähler pro Code gespeichert, ohne Daten des Scannenden).

Berechtigungen und Zweckangaben im Build: Fotomediathek (DE/EN, `docs/IOS_TESTFLIGHT.md`), Mitteilungen (nach dem eigenen Hinweis AUTH-10). **Keine** Kamera, kein Mikrofon, kein Standort, kein Tracking. Android: System-Fotoauswahl, keine Medienberechtigung; die Release-Manifeste werden von `build-apk.ps1` gegen eine Allow-List geprüft.

## 7. Nutzergenerierte Inhalte (Apple 1.2, Google UGC-Richtlinie)

| Anforderung | Wo in der App / im Dienst |
|---|---|
| Nutzungsbedingungen, denen man zustimmt | Registrierung: Zustimmung zu AGB + Datenschutz (AUTH-03); AGB und Community-Richtlinien unter Einstellungen → Rechtliche Texte (SET-17/18) und auf `/agb`, `/community-richtlinien`; bei geänderten Bedingungen erneute Zustimmung (ADR-236 f) |
| Filtern unangemessener Inhalte | Wortfilter auf Fahrzeugbeschreibungen, Build-Notizen, Bio und Anzeigename (blockiert) und Nachrichten (markiert zur Prüfung) (ADR-240 d); Moderations-Warteschlange im Admin (ADM-20…23); optionale KI-Vorsortierung, Entscheidung immer durch Menschen (ADR-243) |
| Melden | „Melden“ auf Profilen, Fahrzeugen, Fotos, Build-Updates und Nachrichten (Menü ⋯ bzw. langes Drücken); ohne Konto `/melden` (WEB-09); eigene Meldungen unter Einstellungen → Meldungen & Entscheidungen |
| Blockieren | „Blockieren“ auf Profilen, in Unterhaltungen und Nachrichtenanfragen; Liste unter Einstellungen → Privatsphäre & Kontakt → Blockierte Konten; danach sehen beide gegenseitig weder Profile noch Fahrzeuge und können sich nicht schreiben; die blockierte Person wird nicht benachrichtigt |
| Reaktion auf Meldungen | Moderations-Warteschlange mit Priorität und Fristen; Entscheidungen mit Begründung (DSA Art. 17), Einspruch (SAFE-01). **Owner-Zusage für den Review: Meldungen werden innerhalb von 24 Stunden geprüft** (Personal einplanen) |
| Veröffentlichte Kontaktdaten | Impressum (`/impressum`, in der App unter Rechtliche Texte), Support-Kontakt in der App (SET-15) und `/kontakt`, Melde-Adresse `MODERATION_EMAIL` |
| Sperren von Nutzern | Einschränken/Sperren durch das Team (ADM-09…13), mit Begründung und Einspruchsmöglichkeit |

## 8. Konto-Löschung

- **In der App:** Profil → Einstellungen → Konto → **Konto löschen** (SET-13): Passwort (und ggf. Zwei-Faktor-Code), Konto sofort deaktiviert, endgültige Löschung nach spätestens 30 Tagen (`PruneDeletedAccountsCommand`).
- **Im Web, ohne App:** `https://<domain>/konto-loeschen` (WEB-05) — diese URL in Google Play unter „Datensicherheit → Kontolöschung“ eintragen.
- Was bleibt (steht in der Datenschutzerklärung §9): Nachrichten beim Gegenüber als „Gelöschtes Mitglied“, Moderationsfälle bis 36 Monate, Protokolle nach ihren Fristen. Teilweise Löschung (einzelne Fahrzeuge, Fotos, Nachrichten) geht jederzeit in der App.

## 9. Hinweise für die Prüfung (App Review Notes)

**Demo-Konto** (auf dem **Produktions**-Server anlegen, nicht Staging; ohne Zwei-Faktor-Schutz; mit einem veröffentlichten Fahrzeug mit Fotos und Mods und einer Unterhaltung mit einem zweiten Testkonto):

```
E-Mail:   [[review@<domain>]]
Passwort: [[Passwort, nur im Store-Formular eintragen, nirgends sonst]]
```

**Text (EN, für beide Stores):**

```
SPEED CLUB is a community app for car enthusiasts (16+). Members document their cars (specs, modifications, photos) and get a QR code per car that links to the car's public page.

Demo account: see the sign-in fields. It owns one published car ("Garage" tab) and has one conversation ("Messages" tab).

How to check the main features:
- Garage tab → the car → QR icon: shows the car's QR code. Scanning it with any phone camera opens https://<domain>/v/<slug> in the browser, no account needed.
- Report and block: on any member profile or car page, tap "⋯" → "Report" or "Block". Long-press a message to report it. Reports go to our moderation team, which reviews them within 24 hours.
- Account deletion: Profile → Settings → Account → Delete account (also on the web: https://<domain>/konto-loeschen).
- No ads, no tracking, no in-app purchases. Photos are picked with the system photo picker; the camera and location are never used.
- [Only if push is configured] Push notifications are optional and requested after an in-app explanation.

Contact for the review: [[Name, phone, e-mail]]
```

## 10. Google Play: weitere Punkte

- **App-Signatur durch Google Play:** beim ersten AAB aktivieren; der vorhandene Upload-Schlüssel (OA-8, SHA-256 `95:EF:80:…:F0:79`) bleibt Upload-Schlüssel. Danach das **App-Signatur-Zertifikat** aus Play Console → App-Integrität zusätzlich in `ANDROID_CERT_SHA256` auf dem Server eintragen (kommagetrennt), sonst öffnen App Links aus dem Play-Build nicht die App (`docs/DEPLOY.md` §3).
- **AAB statt APK:** `build-apk.ps1` baut APKs für Tester. Für den Store: EAS-Profil `production` (`buildType: app-bundle`) oder ein lokaler `bundleRelease`-Build (noch kein Skript; offen für den Release-Engineer).
- **Ziel-API 36** erfüllt; **16-KB-Seitengröße** ist für Updates ab 1. Februar 2027 Pflicht: vor dem Upload die nativen Bibliotheken mit dem 16-KB-Check von Android Studio prüfen (`07` §7).
- **Testpflicht für neue private Entwicklerkonten:** Neue Play-Konten von Privatpersonen müssen vor der Produktion einen geschlossenen Test mit mindestens 12 Testern über 14 Tage durchführen; Organisationskonten (mit D-U-N-S-Nummer) nicht. Konto daher als **Organisation** anlegen.
- **Erklärungen in der Play Console:** Werbung: nein. Regierungs-App: nein. Finanzfunktionen: keine. Gesundheit: keine. Nachrichten-App: nein. Zugriff für die Prüfung: Demo-Konto aus 9.

## 11. Offene Owner-Aufgaben für den Store-Start

| Aufgabe | Bezug |
|---|---|
| Apple Developer Program (als Organisation, D-U-N-S), App-Store-Connect-Eintrag `de.speedclub.app` | OA-15 |
| Google-Play-Console-Konto als Organisation (D-U-N-S), App anlegen, Paketname `de.speedclub.app` registrieren | **neu: OA-19** |
| Produktions-Server mit HTTPS und finaler Domain (Datenschutz-, Support- und Lösch-URL müssen öffentlich erreichbar sein) | OA-11, OA-12 |
| Finale Rechtstexte ohne Platzhalter, von der Rechtsberatung geprüft; Datenschutzerklärung passend zu 5 und 6 | OA-10, OA-17 |
| Demo-Konto für die Prüfung auf dem Produktions-Server, Ansprechperson mit Telefon für Apple | **neu: OA-20** |
| Freigabe der Store-Texte (3), Screenshots (2) und Kategorie/Altersstufe (1, 4) | **neu: OA-20** |
| Lizenz der Screenshot-Fotos für Store-Werbung bestätigen oder eigene Fotos liefern | OA-3 / OA-6 |
| Expo-Projekt + FCM/APNs für Push (nicht Pflicht für die Prüfung; ohne Push den Push-Satz aus 9 streichen) | OA-14 |
| Personal für Moderation (24-Stunden-Zusage aus 7 und 9) und mindestens zwei Owner/Admins für das Vier-Augen-Prinzip | `docs/DEPLOY.md` §7 |
