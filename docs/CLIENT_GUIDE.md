# SPEED CLUB — Testanleitung für Kunde und Tester

> Stand: 9. November 2026 (Phase 3). Für alle, die SPEED CLUB vor dem Store-Start testen. Kurz gesagt: App installieren, ein echtes Konto anlegen, dein Auto eintragen, den QR-Code ausprobieren und alles melden, was hakt.

## 1. Welche Version du testest

- **Android:** eine APK-Datei (Release-Build, gleich schnell und gleich signiert wie später im Play Store). Den Dateinamen, die Build-Nummer und die Prüfsumme (SHA-256) bekommst du mit dem Download-Link; alle Builds stehen in `docs/RELEASES.md`.
- **Web:** dieselbe App im Browser unter `https://<Test-Domain>/app` (am Handy und am Rechner).
- **iPhone:** kommt später über TestFlight (siehe 7).
- Welche Version auf deinem Handy läuft, siehst du in der App unter **Profil → Einstellungen → Über die App → Version** (z. B. „0.3.0 (Build 6)“). Diese Angabe gehört in jede Fehlermeldung.

**Wichtig zur Verbindung:** Solange es keinen öffentlichen Test-Server gibt, sind die APKs „LAN-Builds“. Sie sprechen nur mit dem Entwicklungsrechner und funktionieren deshalb nur **im selben WLAN, während dieser Rechner läuft**. Sobald der Test-Server online ist, bekommst du einen „Staging“-Build, der überall funktioniert. Welche Art du hast, steht im Dateinamen (`…-lan-…` oder `…-staging-…`).

## 2. App installieren (Android)

1. Den Download-Link **auf dem Handy** öffnen und die APK herunterladen.
2. Datei öffnen. Beim ersten Mal fragt Android, ob dein Browser (oder die Dateien-App) Apps installieren darf: **„Installation aus dieser Quelle erlauben“** einschalten, zurück, **Installieren**.
3. Warnt Google Play Protect: **„Details“ → „Trotzdem installieren“**. Die Warnung kommt, weil die App noch nicht im Play Store ist.
4. Optional, für Vorsichtige: Die Prüfsumme der Datei muss mit der SHA-256 aus dem Link übereinstimmen.

**Update:** Die neue APK einfach über die alte installieren. Dein Login und deine Daten bleiben erhalten.

**Alte Test-Builds vorher deinstallieren (einmalig):** Die ersten Builds vom 2. November 2026 (Version 0.1.0, Build 1) waren mit einem älteren Schlüssel signiert. Hast du so einen Build installiert, bricht die Installation einer neuen APK mit „App nicht installiert“ oder „Paket steht in Konflikt mit einem vorhandenen Paket“ ab. Dann: **Einstellungen → Apps → SPEED CLUB → Deinstallieren**, danach die neue APK installieren und dich neu anmelden. Das ist nur einmal nötig; alle Builds ab 0.1.0 Build 2 nutzen den neuen Schlüssel.

## 3. Erste Schritte

1. **Konto erstellen:** App öffnen → „Konto erstellen“ → E-Mail-Adresse und Passwort, Bestätigung „mindestens 16 Jahre“ und Zustimmung zu AGB und Datenschutz. Bitte eine **echte Adresse** nehmen, die du lesen kannst.
2. **E-Mail bestätigen:** Du bekommst einen 6-stelligen Code per E-Mail. Code in der App eingeben (oder auf den Link in der Mail tippen). Keine Mail? Spam-Ordner prüfen, dann „Neuen Code anfordern“.
3. **Benutzername und Profil:** Benutzernamen wählen (z. B. `max.e46`), optional Anzeigename, Stadt, Profilbild. Danach fragt die App, ob sie dir Mitteilungen schicken darf (siehe 6: Push ist im Test noch aus).
4. **Garage:** Tab **Garage** → „Fahrzeug hinzufügen“. Vier Schritte: **Fahrzeug** (Marke, Modell, Generation, Baujahr) → **Technik** (Motor, Leistung, Drehmoment, Antrieb) → **Fotos** → **Prüfen & veröffentlichen**. Du kannst jederzeit „Entwurf speichern“ und später weitermachen.
5. **Mods eintragen:** Im Fahrzeug → **Mods** → Kategorie wählen (z. B. „Räder & Reifen“, „Fahrwerk“, „Abgasanlage“) → Felder ausfüllen → Speichern.
6. **Veröffentlichen und Sichtbarkeit:** Im Fahrzeug unter **Sichtbarkeit**: „Öffentlich“, „Nicht gelistet“ (nur über Link und QR-Code, nicht in Suche und Feed) oder „Privat“.
7. **QR-Code und Sticker:** In der Garage beim Fahrzeug auf das QR-Symbol tippen → **Herunterladen** (PNG, SVG oder PDF-Sticker) oder **Teilen**. Unter **Sticker-Platzierung** steht, wo ein Sticker am Auto erlaubt ist. Zum Testen den Code mit einem **zweiten Handy** scannen (normale Kamera-App).
8. **Öffentliche Seite:** Der Scan öffnet die öffentliche Fahrzeugseite im Browser, ohne Konto. Sie soll schnell laden und genauso aussehen wie das Fahrzeug in der App, mit „In der App öffnen“ und „Registrieren“.

## 4. Was du bitte testest

Nimm dir pro Bereich ein paar Minuten. Teste ruhig auch Unsinn: leere Felder, sehr lange Texte, Flugmodus mitten im Hochladen.

| Bereich | Was ausprobieren | Worauf achten |
|---|---|---|
| **Start** | „Für dich“ und „Folge ich“, Featured Build, Neue Builds, Mitteilungen (Glocke) | Lädt alles? Stimmen Namen, Fotos, Zahlen? |
| **Entdecken** | Suche nach Marke, Modell, Mods oder Mitgliedern, Filter (Räder, Fahrwerk, Leistung), Liste/Raster, Marken- und Modellseiten | Passen die Treffer? Lassen sich Filter zurücksetzen? |
| **Garage** | Fahrzeug anlegen, Entwurf fortsetzen, Fotos (Reihenfolge, Titelbild), Technik, Mods, Verlauf, Fahrzeug löschen | Gehen Eingaben verloren? Sind die Einheiten (PS/kW, Nm, Zoll, ET) richtig? |
| **QR** | Herunterladen in allen Formaten, Teilen, Scan mit zweitem Handy, Scans-Statistik, „QR-Code ersetzen“ | Öffnet der Scan die richtige Seite? Zeigt der alte Code nach dem Ersetzen „nicht mehr gültig“? |
| **Profil** | Profil bearbeiten, anderen Mitgliedern folgen, Follower-Listen, Gespeichert, eigenes Profil teilen | Stimmen die Zahlen? Sieht dein Profil für andere richtig aus? |
| **Nachrichten** | Nachricht an ein anderes Testkonto, Nachrichtenanfrage annehmen/ablehnen, Foto oder Fahrzeug schicken, Reaktionen, Lesebestätigung | Kommt die Nachricht an (ohne Echtzeit nach wenigen Sekunden, siehe 6)? |
| **Sicherheit** | Melden und Blockieren (siehe unten), Zwei-Faktor-Schutz einschalten, Passwort und E-Mail ändern, Geräte & Sitzungen | Klare Texte? Kommen die Sicherheits-Mails? |
| **Einstellungen** | Erscheinungsbild (Carbon, Schwarz, Hell, System), Sprache Deutsch/Englisch, Einheiten, Mitteilungen, Privatsphäre, Daten exportieren, Konto löschen (nur mit einem Wegwerf-Konto!), Hilfe & Support | Wirkt jede Einstellung sofort? Ist die Export-Datei vollständig? |
| **Web** | Dieselben Abläufe im Browser unter `/app`, am Handy und am Rechner (breites Fenster zeigt Seitenleiste) | Sieht es aus wie die App? Funktionieren Tastatur und Zurück-Taste? |
| **Darstellung** | Große Schrift (Android: Einstellungen → Display → Schriftgröße), Dunkel/Hell | Wird Text abgeschnitten oder überlappt etwas? |

**Melden und Blockieren:** Auf Profilen und Fahrzeugseiten über das **Menü (⋯)** → „Melden“ oder „Blockieren“; bei Fotos im Vollbild über das Menü; bei Nachrichten durch **langes Drücken** auf die Nachricht; in einer Unterhaltung unter „Info“. Deine Meldungen und Entscheidungen dazu findest du unter **Einstellungen → Meldungen & Entscheidungen**. Ohne Konto geht es über `https://<Test-Domain>/melden`.

## 5. Fehler melden

Pro Fehler eine Meldung, am liebsten per E-Mail an das Projektteam (Adresse unten) oder über **Einstellungen → Support kontaktieren** in der App. Bitte so:

```
Titel:            (ein Satz: was ist kaputt?)
Build/Version:    (Einstellungen → Über die App, z. B. 0.3.0 (Build 6))
Gerät:            (z. B. Samsung Galaxy S23, Android 15 – oder Browser + Rechner)
Theme/Sprache/Schrift: (z. B. Carbon / Deutsch / große Schrift)
Schritte:         1. … 2. … 3. …
Erwartet:         (was hätte passieren sollen?)
Tatsächlich:      (was ist passiert?)
Beleg:            Screenshot oder Bildschirmaufnahme
Wie schlimm:      blockiert mich / stört / Schönheitsfehler
Wo:               (Tab und Bildschirm, z. B. Garage → Fahrzeug → Mods)
```

Das Team ergänzt Route, Status und den Commit der Korrektur und meldet sich, wenn der Fehler in einem neuen Build behoben ist.

## 6. Bekannte Grenzen im Test

- **Keine Push-Mitteilungen:** Dafür fehlen noch das Expo-Konto und die Firebase-Schlüssel (Owner-Aufgabe OA-14). Neue Nachrichten, Follower und Entscheidungen siehst du in der App (Glocke, Zähler an den Tabs) und per E-Mail.
- **Keine Echtzeit im Chat:** Ohne Pusher-Schlüssel (OA-13) fragt die App regelmäßig nach neuen Nachrichten: alle 3 Sekunden in einer offenen Unterhaltung, alle 15 Sekunden in der Übersicht. „Schreibt gerade …“ erscheint deshalb nicht.
- **KI-Funktionen sind aus:** Ohne Schlüssel eines KI-Anbieters (OA-18) gibt es keine KI-Suche, keine KI-Vorschläge und keine Übersetzungen. Die Einträge dafür erscheinen nicht.
- **iPhone:** noch keine App. Sie kommt über TestFlight, sobald der Apple-Developer-Account existiert (OA-15). Bis dahin testen iPhone-Nutzer die Web-App unter `/app` in Safari.
- **E-Mails:** Solange kein Mailserver eingerichtet ist (OA-16), kommen keine echten Mails an; das Team gibt dir den Bestätigungscode dann direkt.
- **Rechtstexte:** Impressum, Datenschutz und AGB sind Entwürfe mit Platzhaltern (`[[…]]`), bis die Firmendaten und die Prüfung durch die Rechtsberatung vorliegen (OA-10, OA-17).
- **Testdaten:** Auf dem Test-Server gibt es keine Demo-Mitglieder; leere Listen am Anfang sind normal. Legt euch gegenseitig Konten und Fahrzeuge an.
- **Daten im Test sind nicht dauerhaft:** Vor dem Start kann der Test-Server zurückgesetzt werden.

## 7. iPhone über TestFlight (später)

Sobald es so weit ist: **TestFlight** aus dem App Store installieren → Einladungs-E-Mail öffnen und annehmen → SPEED CLUB installieren. Ein TestFlight-Build läuft nach 90 Tagen ab; neue Builds kommen automatisch.

## 8. Was „getestet“ heißt

Jeder Build hat vorher automatische Prüfungen bestanden: Abläufe im Web und auf Android, alle Bildschirme in allen Themes, beiden Sprachen und mit großer Schrift, Barrierefreiheit und Sicherheit. Das heißt nicht, dass nie ein Fehler auftritt. Genau dafür bist du da.

## 9. Kontakt

- **Projektteam:** [[Name, E-Mail-Adresse und Telefon der Ansprechperson]]
- **In der App:** Einstellungen → Support kontaktieren (Antworten erscheinen unter „Deine Anfragen“).
- **Dringend** (App startet nicht, Daten weg, Sicherheitsproblem): bitte zusätzlich anrufen.
