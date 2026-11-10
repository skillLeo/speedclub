# SPEED CLUB Admin — Handbuch für das Team

> Stand: 9. November 2026 (Phase 3, alle Admin-Bereiche gebaut). Für alle, die im SPEED CLUB Admin arbeiten: Owner, Admin, Moderation, Support, Redaktion und Analyse. Das Admin spricht dich mit „du“ an, dieses Handbuch auch. Alle Namen von Menüpunkten, Schaltflächen und Feldern stehen hier so, wie du sie auf dem Bildschirm siehst (deutsche Oberfläche).
>
> Technische Einrichtung (Server, erster Owner, IP-Freigabe): `docs/DEPLOY.md`, Abschnitt 7.

## Inhalt

1. [Grundregeln in einem Absatz](#1-grundregeln-in-einem-absatz)
2. [Erste Schritte](#2-erste-schritte)
3. [Rollen und was sie dürfen](#3-rollen-und-was-sie-dürfen)
4. [Vier-Augen-Freigaben](#4-vier-augen-freigaben)
5. [So ist das Admin aufgebaut](#5-so-ist-das-admin-aufgebaut)
6. [Übersicht: Dashboard, Suche, Hinweise](#6-übersicht-dashboard-suche-hinweise)
7. [Mitglieder](#7-mitglieder)
8. [Fahrzeuge & Medien](#8-fahrzeuge--medien)
9. [Katalog](#9-katalog)
10. [QR](#10-qr)
11. [Moderation](#11-moderation)
12. [Support](#12-support)
13. [Marke & Inhalte](#13-marke--inhalte)
14. [Konfiguration](#14-konfiguration)
15. [Team & Rollen](#15-team--rollen)
16. [Audit & Datenschutz](#16-audit--datenschutz)
17. [System](#17-system)
18. [Einstellungen](#18-einstellungen)
19. [Mitgliedschaften (nur wenn aktiviert)](#19-mitgliedschaften-nur-wenn-aktiviert)
20. [KI-Vorschläge](#20-ki-vorschläge)
21. [Was du nie tun kannst](#21-was-du-nie-tun-kannst)
22. [Wenn etwas nicht klappt](#22-wenn-etwas-nicht-klappt)

---

## 1. Grundregeln in einem Absatz

Im Admin ist fast alles möglich, aber nichts passiert unbemerkt: Jede Änderung und jeder Blick auf sensible Daten landet mit deinem Namen, Zeitpunkt, Vorher/Nachher und Begründung im **Audit-Log**. Du siehst nur die Bereiche, die deine Rolle erlaubt; der Server prüft es noch einmal. Riskante Aktionen führt eine **zweite Person** aus (Vier-Augen-Prinzip). Geschützte Aktionen fragen nach deinem **Passwort**, wenn du es in den letzten 5 Minuten nicht bestätigt hast. Alles, was Mitglieder betrifft (Einschränken, Sperren, Ausblenden, Löschen von Inhalten), ist eine **Entscheidung nach dem Digital Services Act (DSA)**: Das Mitglied bekommt eine Begründung in der App und per E‑Mail und kann Einspruch einlegen.

---

## 2. Erste Schritte

### 2.1 Einladung annehmen

1. Ein Owner oder Admin lädt dich im Bereich **Team** ein. Du bekommst eine E‑Mail mit einem Link. Er gilt **72 Stunden und nur einmal**.
2. Öffne den Link direkt aus der E‑Mail. Es erscheint **„Einladung annehmen“**.
3. Gib dein **Neues Passwort** ein (mindestens 12 Zeichen; ein langer Satz ist sicherer als ein kurzes Wort) und wiederhole es unter **„Passwort wiederholen“**.
4. Klicke auf **„Passwort festlegen“**, dann auf **„Zur Anmeldung“**.

Ist der Link abgelaufen oder schon benutzt, bitte die einladende Person um **„Einladung erneut senden“**; der neue Link ersetzt den alten.

### 2.2 Anmelden

1. Öffne `https://<Domain>/admin/login`. Die Seite heißt **„Anmeldung fürs Team“**.
2. Gib **E‑Mail** und **Passwort** ein, klicke auf **„Anmelden“**.
3. Gib den **6-stelligen Code** aus deiner Authenticator-App ein und klicke auf **„Bestätigen“**. Ohne Telefon: **„Wiederherstellungscode verwenden“** (siehe 2.4).

Dein Team-Konto ist vollständig getrennt von einem Mitgliedskonto in der App: eigene Adresse, eigenes Passwort, eigene Anmeldung.

### 2.3 Zwei-Faktor-Pflicht

Ohne eingerichteten Zwei-Faktor-Schutz kommst du in keinen Bereich des Admins. Nach der ersten Anmeldung landest du automatisch bei **„Zwei-Faktor-Anmeldung einrichten“** (Hinweis oben: „Pflicht für alle im Team“). Drei Schritte:

1. **Passwort:** Bestätige dein Passwort, dann **„Weiter“**.
2. **App verbinden:** Scanne den QR-Code mit einer Authenticator-App (z. B. 1Password, Google Authenticator, Authy). Geht das nicht, tippe den **„Schlüssel für die manuelle Eingabe“** ab (**„Kopieren“** hilft). Gib den **„6-stelligen Code aus der App“** ein und klicke auf **„Code bestätigen“**. Passt der Code nicht, prüfe die Uhrzeit deines Telefons und nimm den nächsten Code.
3. **Codes sichern:** siehe 2.4. Danach **„Weiter zum Dashboard“**.

Bildschirm: `reports/visual/phase-3/ADM-03-scan__1280x800__carbon__de.png`.

### 2.4 Wiederherstellungscodes

- Nach dem Einrichten zeigt das Admin deine **Wiederherstellungscodes** (Format `xxxxxxxxxx-xxxxxxxxxx`) **nur dieses eine Mal**.
- Sichere sie mit **„Als Textdatei speichern“** oder kopiere sie in deinen Passwort-Manager, **nicht** auf dasselbe Telefon wie die Authenticator-App. Hake **„Ich habe die Codes sicher gespeichert.“** an.
- Jeder Code gilt **einmal**. Du brauchst ihn, wenn dein Telefon fehlt: bei der Anmeldung **„Wiederherstellungscode verwenden“**.
- Später kannst du sie unter **Einstellungen → Mein Konto → Wiederherstellungscodes** wieder anzeigen (**„Codes anzeigen“**) oder ersetzen (**„Neue Codes erzeugen“**). Beides verlangt einen aktuellen Code aus deiner App. Neue Codes machen die alten ungültig und melden alle anderen Sitzungen ab.

### 2.5 Sitzung läuft nach 30 Minuten ab

- Nach **30 Minuten ohne Aktivität** meldet dich das Admin aus Sicherheitsgründen ab.
- Nach 25 Minuten erscheint der Hinweis **„Sitzung läuft ab“** mit einem Countdown. Klicke auf **„Sitzung verlängern“**, wenn du weiterarbeitest.
- Verpasst du ihn, landest du bei der nächsten Aktion auf der Anmeldung mit „Deine Sitzung ist abgelaufen. Melde dich erneut an.“ Nicht gespeicherte Eingaben sind dann verloren.
- Das Admin lädt im Hintergrund nichts nach. Zahlen und Abzeichen in der Navigation aktualisieren sich, wenn du eine Seite öffnest.

### 2.6 Passwort erneut bestätigen (5 Minuten)

Geschützte Aktionen (fast alle Änderungen an Mitgliedern, Team, Konfiguration, Freigaben) brauchen ein Passwort, das du in den **letzten 5 Minuten** bestätigt hast. Ist es älter, erscheint der Dialog **„Passwort bestätigen“** („Diese Aktion ist geschützt. Bestätige dein Passwort, dann wird sie ausgeführt.“). Gib dein Passwort ein und klicke auf **„Bestätigen und fortfahren“**; die Aktion läuft dann von selbst weiter. Bis dahin ändert sich nichts.

### 2.7 IP-Freigabe

Im Live-System ist das Admin meist nur aus bestimmten Netzen erreichbar (Büro, VPN). Von anderswo, zum Beispiel vom Handy im Mobilfunknetz, antwortet schon die Anmeldeseite mit **„Seite nicht gefunden“ (404)**. Das ist Absicht und kein Fehler. Verbinde dich mit dem freigegebenen Netz oder VPN. Welche Adressen freigegeben sind, legt der Betrieb fest (`docs/DEPLOY.md` 7).

### 2.8 Passwort vergessen

1. Auf der Anmeldung **„Passwort vergessen?“**.
2. Gib die E‑Mail-Adresse deines Team-Kontos ein, **„Link senden“**. Gibt es das Konto, kommt ein Link. Er gilt **60 Minuten** und einmal.
3. **„Neues Passwort festlegen“**, **„Passwort speichern“**. Alle anderen Sitzungen enden.

---

## 3. Rollen und was sie dürfen

Rollen bündeln **Rechte**. Du siehst nur Menüpunkte und Schaltflächen, für die deine Rollen das Recht haben. Ein Teammitglied kann mehrere Rollen haben. Die Tabelle zeigt die **Grundrollen im Auslieferungszustand**. Owner und Admin können die Rechte der übrigen Rollen in der **Rechte-Matrix** ändern (15.4); dann gilt die Matrix, nicht diese Tabelle.

| Rolle (Anzeige im Admin) | Wofür | Rechte im Auslieferungszustand |
|---|---|---|
| **Owner** | Betreiber. Alles, auch Rollen, Owner-Konten und die Angaben zur Organisation. Mindestens 1, höchstens 3. | alle Rechte |
| **Admin** | Leitung. Alles außer Owner-Konten verwalten und die Angaben zur Organisation ändern (nur ansehen). | alle Rechte |
| **Moderation** | Meldungen und Inhalte nach DSA | Meldungen ansehen, Über Meldungen entscheiden, Einsprüche prüfen, Gemeldete Nachrichten lesen, Wortlisten pflegen, Begründungsvorlagen pflegen, Fotos prüfen, Fotos ausblenden, Fahrzeuge ansehen, Fahrzeuge ausblenden, Mitglieder ansehen, Mitglieder einschränken, Mitglieder sperren (höchstens 30 Tage), QR-Codes ansehen, Support-Tickets ansehen, Listen als CSV exportieren |
| **Support** | Hilfe für Mitglieder | Mitglieder ansehen, Persönliche Daten sehen, Link zum Zurücksetzen senden, Sitzungen von Mitgliedern beenden, Ansicht als Mitglied (mit Zustimmung des Mitglieds), Support-Tickets ansehen, Auf Tickets antworten, Textbausteine pflegen, DSGVO-Anfragen ansehen, Fahrzeuge ansehen, QR-Codes ansehen, Listen als CSV exportieren |
| **Redaktion** | Inhalte, Marke, Katalog | Inhalte ansehen, Inhalte bearbeiten, Inhalte veröffentlichen, Marke und Design pflegen, Katalog ansehen, Katalog pflegen, Katalog importieren, QR-Codes ansehen, Listen als CSV exportieren. Rechtstexte nur als Entwurf. |
| **Analyse** | Nur lesen | Statistiken ansehen, Mitglieder ansehen (ohne persönliche Daten), Fahrzeuge ansehen, QR-Codes ansehen, Meldungen ansehen (ohne Nachrichteninhalte). **Keine Exporte.** |

Wichtig zu den Rechten:

- **„Listen als CSV exportieren“** ist nötig für jeden Tabellen-Export (Schaltfläche **„Exportieren“**, „CSV, Adressen maskiert“), zusätzlich zum Recht, die Liste zu sehen. Die Rolle Analyse hat es bewusst nicht.
- **„Persönliche Daten sehen“** entscheidet, ob du E‑Mail-Adressen unmaskiert siehst. Ohne dieses Recht steht dort z. B. `l***@g***.de`.
- **„Vier-Augen-Anfragen freigeben“** haben im Auslieferungszustand **nur Owner und Admin**. Eine Vier-Augen-Aktion, die jemand aus Moderation, Support oder Redaktion anfragt, gibt also immer ein Owner oder Admin frei.
- Diese Rechte sind **immer** Vier-Augen-pflichtig: Mitglieder löschen, Zwei-Faktor von Mitgliedern zurücksetzen, Mitgliederdaten exportieren, Wartungsmodus einschalten, Rollen und Rechte verwalten (bei Vergabe), Audit-Log exportieren.
- Wer eine Rolle braucht oder eine Seite mit **„Kein Zugriff“** sieht: Frag einen Owner oder Admin (Bereich **Team & Rollen**).

---

## 4. Vier-Augen-Freigaben

### 4.1 Was eine Freigabe braucht

Diese Aktionen werden nie sofort ausgeführt. Das Admin legt eine **Anfrage** an; erst wenn eine zweite Person zustimmt, passiert etwas.

| Aktion | Wo | Wer freigibt (zusätzlich: hat „Vier-Augen-Anfragen freigeben“) |
|---|---|---|
| Mitglied sperren (durch das Team) | Mitglieder, Moderation | hat „Mitglieder sperren“ |
| Konto eines Mitglieds löschen | Mitglieder, DSGVO-Anfragen | hat „Mitglieder löschen“ |
| 2FA eines Mitglieds zurücksetzen | Mitglieder | hat das Recht dazu |
| Daten eines Mitglieds exportieren | Mitglieder | hat „Mitgliederdaten exportieren“ |
| Mitgliederliste mit E‑Mail-Adressen exportieren | Mitglieder | hat „Mitgliederdaten exportieren“ und „Persönliche Daten sehen“ |
| Sammelaktionen über **100 Datensätze in 24 Stunden** (Mitglieder, Fahrzeuge ausblenden, Fälle ohne Maßnahme schließen, Ticketstatus, Katalog zusammenführen, Katalog-Import) | jeweilige Liste | hat das Recht der Aktion. Die 100 zählen pro Person und Aktion über 24 Stunden; Aufteilen umgeht die Grenze nicht. |
| Audit-Log exportieren | Audit-Log | hat „Audit-Log exportieren“ |
| Wartungsmodus einschalten (Ausschalten wirkt sofort) | Remote-Konfiguration | hat „Wartungsmodus schalten“ |
| Kritischen Schalter (Feature-Flag) im Live-System ändern | Feature-Flags | hat „Feature-Flags schalten“ |
| AGB oder Datenschutz mit „Erfordert erneute Zustimmung“ veröffentlichen | Rechtstexte | hat „Rechtstexte veröffentlichen“ |
| Rollen ändern, die Admin, Owner oder ein kritisches Recht geben, oder ein Owner-Konto betreffen; Rolle Admin wegnehmen | Team | ein **Owner**, wenn Owner vergeben oder ein Owner-Konto berührt wird; sonst Owner oder Admin |
| Kritische Rechte in der Rechte-Matrix oder einer Rolle vergeben (Rollen und Rechte verwalten, Vier-Augen-Anfragen freigeben, Mitglieder löschen, Mitgliederdaten exportieren, Audit-Log exportieren, Wartungsmodus schalten) | Rollen, Rechte-Matrix | jemand, der keine der betroffenen Rollen hat |
| Owner oder Admin deaktivieren, Owner-Konto reaktivieren oder löschen | Team | bei Owner-Konten ein zweiter Owner |
| Zwei-Faktor eines Teammitglieds zurücksetzen | Team | ein zweiter Owner |

Feste Regeln für jede Freigabe:

- **Wer anfragt, gibt nicht selbst frei.** Und die Person, um die es geht (z. B. bei einer Rollenänderung), kann ihre eigene Anfrage nie freigeben.
- Jede Anfrage trägt eine **Begründung** (10 bis 1.000 Zeichen); sie steht im Audit-Log.
- Eine Anfrage gilt **24 Stunden**. Danach ist sie **„Abgelaufen“**, und nichts wird ausgeführt.
- Bei der Freigabe prüft das Admin alles noch einmal. Hat sich inzwischen etwas geändert (Mitglied gelöscht, Recht entzogen), endet sie als **„Fehlgeschlagen“** („Freigegeben, aber die Aktion war nicht mehr möglich. Nichts wurde geändert.“).
- Für jede Sache gibt es nur eine wartende Anfrage. Fragst du erneut, zeigt das Admin „Diese Anfrage wartet schon auf Freigabe“.

### 4.2 Eine Freigabe anfragen

1. Starte die Aktion wie gewohnt. Vier-Augen-Aktionen erkennst du am Hinweis **„Braucht eine Freigabe“** und an der Schaltfläche **„Freigabe anfragen“** (statt „Speichern“ oder „Löschen“).
2. Gib die **Begründung** ein und bestätige.
3. Oben erscheint **„Freigabe angefragt: …“** mit der Uhrzeit, bis zu der jemand zustimmen muss.
4. Sag der Person, die freigeben soll, kurz Bescheid. Das Admin verschickt dafür keine E‑Mail; die Anfrage erscheint bei ihr unter **Hinweise** und **Freigaben** mit einer Zahl am Menüpunkt.

Datensätze mit einer wartenden Anfrage zeigen oben „Wartet auf Freigabe: … (bis …)“.

### 4.3 Freigeben, ablehnen, zurückziehen

Öffne **Team & Rollen → Freigaben**. Drei Reiter:

- **Für mich:** Anfragen anderer, die du freigeben darfst, neueste zuerst.
- **Von mir:** Was du angefragt hast, mit Stand und Ergebnis.
- **Alle:** Alle Anfragen des Teams (nur Owner und Admin).

Jede Zeile zeigt Aktion, Datensatz, wer angefragt hat, Begründung, Zeitpunkt, Restzeit („läuft ab in … Std. … Min.“) und die Änderung als **Vorher / Nachher**.

- **Freigeben:** **„Freigeben“** → optional Kommentar (3 bis 1.000 Zeichen) → bestätigen. Die Aktion wird **sofort** ausgeführt, in deinem Namen als zweite Person. Dein Passwort muss frisch bestätigt sein (2.6).
- **Ablehnen:** **„Ablehnen“** → **Kommentar ist Pflicht** (3 bis 1.000 Zeichen; die anfragende Person sieht ihn) → bestätigen. Nichts wird ausgeführt.
- **Zurückziehen:** Nur die anfragende Person, im Reiter **Von mir**: **„Zurückziehen“**. Die Anfrage endet, nichts wird ausgeführt.

Status, die du siehst: Wartet · Wird ausgeführt · Ausgeführt · Fehlgeschlagen · Abgelehnt · Abgelaufen · Zurückgezogen. Große Sammelaktionen laufen nach der Freigabe Datensatz für Datensatz; das Ergebnis zeigt „… erledigt, … nicht möglich“.

**Exporte nach einer Freigabe** (Mitgliederdaten, Mitgliederliste, Audit-Log) lädt **nur die anfragende Person** herunter, **24 Stunden** lang: unter **Hinweise → Bereit zum Herunterladen**, in **Freigaben → Von mir** (**„Herunterladen“**) oder beim Mitgliederexport im Reiter **Datenschutz** des Mitglieds. Jeder Download steht im Audit-Log.

Bildschirm: `reports/visual/phase-3/ADM-43__1280x800__carbon__de.png`.

---

## 5. So ist das Admin aufgebaut

- **Seitenleiste links** mit den Bereichen in dieser Reihenfolge: Übersicht · Mitglieder · Fahrzeuge & Medien · Katalog · QR · Moderation · Support · Marke & Inhalte · Konfiguration · Team & Rollen · Audit & Datenschutz · System · Einstellungen. Du siehst nur Einträge, die deine Rolle öffnen darf. Unter 1024 px Breite öffnet **„Navigation öffnen“** die Leiste als Overlay.
- **Obere Leiste:** Suchfeld („Mitglied, Fahrzeug, QR-Code oder Fall suchen“), Umgebungsabzeichen **LOCAL**, **STAGING** oder **PROD** (PROD = Live-System, Änderungen wirken sofort für alle Mitglieder), Umschalter für helles/dunkles Design, Sprache DE/EN, dein Menü mit **„Mein Konto“** und **„Abmelden“**.
- **Befehlspalette:** **⌘K** (Mac) oder **Strg K** (Windows) auf jeder Seite. Tippe einen Seitennamen, `@username`, eine Fahrzeug-Kennung, einen QR-Code oder eine Fallnummer; **Enter** öffnet, **„Link kopieren“** kopiert den Link.
- **Tabellen:** Filter oben, **„Anwenden“**; **„Filter zurücksetzen“**; **„Spalten“** blendet Spalten ein und aus (wird pro Tabelle gemerkt); **„Ansichten“** sind gespeicherte Filter (vorgegebene und eigene: **„Ansichten verwalten“ → „Aktuelle speichern“**, nur du siehst deine); **„Pro Seite“** 25, 50 oder 100. Wählst du Zeilen aus, erscheint unten die Auswahlleiste für Sammelaktionen mit einem Ergebnis pro Datensatz.
- **Datensatzseiten** (Mitglied, Fahrzeug, Fall, Ticket …): Kopf mit Status und Aktionen (weitere unter **„Weitere Aktionen“**), Reiter, rechts **„Aktivität“** aus dem Audit-Log.
- **Bestätigungen:** Unumkehrbares bestätigst du, indem du **LÖSCHEN** eintippst. Wo eine Begründung Pflicht ist, steht das Feld **„Begründung“** („Steht im Audit-Log. 10 bis 1.000 Zeichen.“).
- **Daten und Zahlen:** Datum im Format `14.06.2026, 18:42` (deutsche Zeit).

---

## 6. Übersicht: Dashboard, Suche, Hinweise

### 6.1 Dashboard

**Übersicht → Dashboard.** Oben die **Warteschlangen**, die deine Rolle bearbeitet, jeweils mit Anzahl und ältestem Eintrag; ein Klick öffnet die Liste:

Offene Meldungen · Einsprüche · DSGVO-Fristen ≤ 7 Tage · Support-Tickets · Fehlgeschlagene Jobs · Zeitplaner · Hintergrund-Jobs. „Alles erledigt“ heißt: leer.

Darunter (nur mit „Statistiken ansehen“) die **Kennzahlen** mit Verlauf der letzten 14 Tage: Neue Mitglieder heute / 7 Tage / 30 Tage, Aktiv heute (DAU), Aktiv diese Woche (WAU), Veröffentlichte Fahrzeuge, QR-Scans 7 Tage, QR-Scan → Registrierung 7 Tage, Nachrichten 7 Tage. Es sind nur Summen, keine Personen.

Drei Diagramme: Registrierungen pro Tag (30 Tage), QR-Scans und Registrierungen nach einem Scan (30 Tage), Top 10 Marken.

**„Ø monatlich aktive Nutzer (6 Monate)“**: der Durchschnitt der letzten sechs vollen Monate. Diese Zahl nennst du, wenn eine Behörde nach Art. 24 Abs. 3 DSA fragt.

### 6.2 Suche

**Übersicht → Suche** oder das Suchfeld oben. Gesucht werden:

- Mitglieder nach `@username` (Anfang genügt), nach E‑Mail **nur exakt** und nur mit „Persönliche Daten sehen“,
- Fahrzeuge nach Slug (z. B. `s14-kouki`) oder Kennung,
- QR-Codes nach Code (z. B. `7H2K QXMB`),
- Fälle nach Fallnummer.

Gruppen, für die dir das Recht fehlt, werden nicht durchsucht.

### 6.3 Hinweise

**Übersicht → Hinweise** zeigt, was auf dich persönlich wartet: **Freigaben für dich**, **Dir zugewiesene Fälle**, **Systemwarnungen** (Audit-Kette, fehlgeschlagene Jobs, Zeitplaner, lange Warteschlange), **Bereit zum Herunterladen** (deine freigegebenen Exporte) und **Wird gerade ausgeführt**. Die Zahl am Menüpunkt aktualisiert sich beim Seitenwechsel.

---

## 7. Mitglieder

### 7.1 Liste

**Mitglieder** zeigt alle Konten: Profilbild, Benutzername, Name, E‑Mail (maskiert), Status (Aktiv · Eingeschränkt · Gesperrt · Deaktiviert · Löschung läuft), Fahrzeuge, Follower, Registriert, Zuletzt aktiv, 2FA, Bestätigt.

- **Filter:** Suche (`@benutzername`; mit „Persönliche Daten sehen“ auch genaue E‑Mail), Status, Einschränkung (Nachrichten / Veröffentlichen / Gesperrt), Gemeldet (offener Fall), E‑Mail bestätigt, Fahrzeuge, Registriert von–bis, Zuletzt aktiv von–bis.
- **Ansichten:** Neu diese Woche · Eingeschränkt · Gemeldet · Ohne Fahrzeug.
- **Sammelaktionen** (Zeilen auswählen): Einschränken · Sitzungen beenden · Exportieren (Vier-Augen) · Löschen (Vier-Augen). Bis 500 Datensätze; über 100 brauchen eine Freigabe. Beim Einschränken bekommt **jedes** Mitglied eine eigene Entscheidung mit derselben Begründung.
- **Export:** **„Exportieren“ → „CSV, Adressen maskiert“** (Recht „Listen als CSV exportieren“). Eine Liste **mit** E‑Mail-Adressen ist ein Export personenbezogener Daten: **„CSV mit E‑Mail‑Adressen“ → „Freigabe anfragen“**; die Datei lädst du nach der Freigabe unter **Hinweise** herunter.

### 7.2 Mitgliedsprofil

Reiter:

| Reiter | Inhalt |
|---|---|
| **Übersicht** | Profil, „Registriert über“ (QR-Scan, öffentliche Fahrzeugseite, öffentliches Profil, direkt), Einschränkungen mit Enddatum und Entscheidung, Zahlen, **Einwilligungen** (AGB-Version, Datenschutz-Version, „Zugestimmt am“, Werbe-Einwilligung) |
| **Fahrzeuge** | Fahrzeuge des Mitglieds |
| **Sicherheit & Sitzungen** | Zwei-Faktor an/aus, angemeldete Geräte (Plattform, angemeldet, zuletzt benutzt), Anmeldungen nach Gerät. Nur Datum und Uhrzeit, **keine IP-Adressen** |
| **Meldungen** | Fälle zum Mitglied und Meldungen des Mitglieds, mit Link zum Fall |
| **Nachrichten** | Nur Zahlen (Unterhaltungen, gesendete Anfragen 7/30 Tage, Annahmequote, blockiert/wurde blockiert). **Keine Nachricht, kein Gesprächspartner, keine Vorschau.** Das Öffnen wird protokolliert. Recht: „Nachrichten-Metadaten sehen“ |
| **Audit** | Audit-Ereignisse zu diesem Mitglied |
| **Datenschutz** | Datenexporte (vom Mitglied oder vom Team), Stand einer Löschung |

**E‑Mail-Adresse anzeigen:** Mit „Persönliche Daten sehen“ klickst du neben der maskierten Adresse auf **„Anzeigen“**. Das Anzeigen wird protokolliert („Angezeigt und protokolliert“).

### 7.3 Aktionen am Mitglied

Oben **„Bearbeiten“** und **„Einschränken“**, alles Weitere unter **„Weitere Aktionen“**.

| Aktion | Was passiert | Recht, Schutz |
|---|---|---|
| **Bearbeiten** | Anzeigename, Benutzername, Ort, Über mich. Ein neuer Benutzername gibt den alten frei. Passwörter gibt es hier nie. | Profile bearbeiten, Passwort |
| **Einschränken** | siehe 7.4 | Mitglieder einschränken, Passwort |
| **Aufheben** | hebt eine Einschränkung oder Sperre auf; du schreibst unter „Was das Mitglied liest“, warum (10 bis 5.000 Zeichen). Eine neue Entscheidung, das Mitglied wird informiert. | Mitglieder einschränken, Passwort |
| **Code zum Zurücksetzen senden** | Das Mitglied bekommt die übliche E‑Mail mit dem Code zum Zurücksetzen. Du siehst oder setzt nie ein Passwort. | Link zum Zurücksetzen senden |
| **Passwortänderung erzwingen** | Das Mitglied muss beim nächsten Öffnen der App ein neues Passwort setzen; bis dahin ist jede Sitzung gesperrt. | Link zum Zurücksetzen senden, Passwort |
| **Alle Sitzungen beenden** | Alle Geräte, Browser und Push-Anmeldungen werden abgemeldet; das Mitglied bekommt einen Sicherheitshinweis. | Sitzungen von Mitgliedern beenden, Passwort |
| **2FA zurücksetzen** | nach Freigabe: Anmeldung nur mit Passwort, 2FA neu einrichtbar; E‑Mail an das Mitglied | Vier-Augen, Passwort |
| **E‑Mail ändern** | nur nach geprüfter Identität (z. B. altes Postfach verloren): neue Adresse, Haken **„Identität geprüft“**, Begründung. Beide Adressen werden informiert. | Profile bearbeiten, Passwort |
| **Ansicht als** | siehe 7.5 | Ansicht als Mitglied, Passwort |
| **Daten exportieren** | nach Freigabe entsteht der Datenexport (ZIP) **ohne Nachrichteninhalte**; nur du lädst ihn 24 Stunden lang im Reiter Datenschutz herunter | Vier-Augen |
| **Konto löschen** | nach Freigabe sofort deaktiviert, nach 30 Tagen endgültig gelöscht; E‑Mail an das Mitglied. Bestätigung mit **LÖSCHEN** | Vier-Augen |

### 7.4 Einschränken und Sperren (Begründung nach DSA)

Einschränken und Sperren sind **Entscheidungen nach Art. 17 DSA**. Das Mitglied liest deine Begründung in der App (unter Meldungen & Entscheidungen) und per E‑Mail und kann Einspruch einlegen. Schreib so, dass ein Mitglied es versteht.

1. Im Mitgliedsprofil **„Einschränken“**. Der Dialog heißt „… einschränken oder sperren“.
2. **Maßnahme** wählen:
   - **Nachrichten:** kann keine Nachrichten und Anfragen senden.
   - **Veröffentlichen:** kann nichts veröffentlichen oder öffentlich schalten.
   - **Sperre:** Konto gesperrt. Braucht die Freigabe eines zweiten Teammitglieds.
3. **Dauer:** 1 Tag · 7 Tage · 30 Tage · Bis zu einem Datum (**„Bis einschließlich“**, TT.MM.JJJJ) · Ohne Ende. Die Rolle Moderation sperrt höchstens **30 Tage**; Owner und Admin ohne Grenze.
4. **Begründung für das Mitglied:**
   - **Vorlage** wählen (Spam oder Werbung · Belästigung oder Beleidigung · Identitätsmissbrauch · Nacktheit oder sexuelle Inhalte · Rechtswidriger Inhalt · Eigene Begründung). Sie füllt die Felder; alles bleibt änderbar.
   - **Sachverhalt:** Was passiert ist, in deinen Worten (10 bis 5.000 Zeichen). Das Mitglied liest es.
   - **Grundlage:** **„Steht in“** Community-Richtlinien, AGB oder Gesetz, dazu der **Abschnitt** (bei Gesetz: Vorschrift nennen).
   - Die Hinweise zum Einspruch (intern binnen 6 Monaten, außergerichtliche Streitbeilegung, Gericht) setzt das System selbst ein. Automatisierte Mittel: keine, eine Person entscheidet.
5. **Begründung** fürs Audit-Log (10 bis 1.000 Zeichen; das Mitglied sieht sie nicht).
6. **„Einschränken“** bzw. bei einer Sperre **„Sperre anfragen“** (dann Vier-Augen, siehe 4).

Gibt es zu diesem Mitglied schon einen offenen Fall, entscheidest du diesen Fall; sonst legt das Admin einen Fall „Eigeninitiative“ an. Befristete Maßnahmen enden von selbst (das System prüft alle 15 Minuten).

Bildschirm: `reports/visual/phase-3/ADM-10-restrict__1280x800__carbon__de.png`.

### 7.5 Ansicht als Mitglied (nur lesen) und Einwilligung

Damit siehst du die App so, wie ein Mitglied sie sieht, zum Beispiel um einen Support-Fall nachzuvollziehen.

1. Im Mitgliedsprofil **„Weitere Aktionen“ → „Ansicht als“**.
2. Gib an, warum du die Ansicht brauchst (10 bis 1.000 Zeichen; wird protokolliert).
3. **Einwilligung:** In der Rolle **Support** ist der Haken **„Das Mitglied hat zugestimmt“ Pflicht**. Hol die Zustimmung vorher ein, z. B. im Support-Ticket. Für andere Rollen ist er eine optionale Notiz.
4. **„Ansicht öffnen“.** Die App öffnet sich in einem **neuen Tab** mit dem roten Balken **„Ansicht als @username – nur lesen“**. Blockiert der Browser den Tab, erlaube Pop-ups für das Admin und versuche es erneut.

In der Ansicht kannst du **nichts schreiben**, **keine Nachrichten** sehen, und es gibt keine Push-Mitteilungen. Sie hinterlässt beim Mitglied keine Spuren (keine „zuletzt aktiv“-Zeit, keine gezählten Scans). Sie endet mit **„Beenden“** im roten Balken, mit **„Ansicht beenden“** im Admin oder automatisch nach **30 Minuten**. Start und Ende stehen im Audit-Log.

---

## 8. Fahrzeuge & Medien

### 8.1 Fahrzeuge

**Fahrzeuge & Medien → Fahrzeuge:** Titelbild, Marke/Modell/Generation, Baujahr, Besitzer, Sichtbarkeit (Öffentlich · Nur mit Link · Privat), Moderation (Sichtbar · Ausgeblendet · Gemeldet), Fotos, Mods, QR, geändert. Ansichten: Ausgeblendet · Gemeldet · Ohne QR-Code.

Fahrzeugseite mit den Reitern **Details · Fotos · Mods · QR · Verlauf · Meldungen**. Aktionen:

- **Öffentliche Seite:** öffnet die Seite, die Besucher sehen.
- **Bearbeiten:** Katalog-Zuordnung (Marke, Modell, Generation, Baujahr) und Titelfelder. Erscheint nicht als Build-Update. Recht: Fahrzeuge bearbeiten.
- **Ausblenden:** Das Fahrzeug wird privat und aus der Suche genommen; der Besitzer kann es nicht selbst wieder zeigen. Mit Begründung für den Besitzer wie in 7.4 (Vorlage, Sachverhalt, Grundlage) und Einspruchsmöglichkeit. Recht: Fahrzeuge ausblenden.
- **Einblenden:** neue Entscheidung, die das Ausblenden aufhebt; vorherige Sichtbarkeit kommt zurück. Du schreibst, was der Besitzer liest.
- **Löschen:** erst eine Entscheidung mit Begründung an den Besitzer, dann wird das Fahrzeug mit allen Fotos gelöscht und der QR-Code gesperrt; nach 30 Tagen endgültig. Bestätigung mit **LÖSCHEN**. Recht: Fahrzeuge löschen.
- **Sammelaktion „Ausblenden“** in der Liste; über 100 in 24 Stunden mit Freigabe.

### 8.2 Fotoprüfung (Prüfwarteschlange)

**Fahrzeuge & Medien → Fotoprüfung.** Reiter **Neu** (noch nicht geprüft, neueste zuerst) · **Gemeldet** (Foto mit offenem Fall) · **Ausgeblendet**. Chat-Fotos erscheinen hier nie.

So arbeitest du die Warteschlange ab:

1. Klicke in die Liste. Die Tastenkürzel gelten, sobald die Liste den Fokus hat (Hinweis „In der Liste:“ steht immer sichtbar daneben):

   | Taste | Wirkung |
   |---|---|
   | **J** | nächstes Foto |
   | **K** | voriges Foto |
   | **A** | freigeben |
   | **H** | ausblenden (öffnet den Dialog mit der Begründung) |

2. **Freigeben** (A) markiert das Foto als geprüft. Recht: Fotos prüfen.
3. **Ausblenden** (H) entfernt das Foto sofort; das Original bleibt privat für einen möglichen Einspruch. Der Besitzer liest die Begründung (wie 7.4). Recht: Fotos ausblenden, Passwort.
4. Im Reiter **Ausgeblendet** holt **„Einblenden“** ein Foto mit einer neuen Entscheidung zurück; es wird aus dem Original neu erstellt.
5. Das Original eines ausgeblendeten Fotos zeigt **„Anzeigen“**; das wird protokolliert.

Ist die KI-Prüfhilfe eingeschaltet, steht an Fotos **„KI-Vorschlag … %“** (siehe 20).

Bildschirm: `reports/visual/phase-3/ADM-13__1280x800__carbon__de.png`.

---

## 9. Katalog

Grundregel: **Was ein Fahrzeug oder eine Mod nutzt, wird nie gelöscht.** Du deaktivierst es oder führst es zusammen. Löschen geht nur bei Einträgen, auf die nichts verweist. Jede Änderung steht im Audit-Log; die App sieht sie ohne neues Update.

### 9.1 Fahrzeugkatalog (Marken, Modelle, Generationen)

**Katalog → Fahrzeugkatalog**, Reiter **Marken** und **Anfragen**.

- **Anlegen:** **„Neue Marke“**; in einer Marke **„Modell hinzufügen“**; in einem Modell **„Generation hinzufügen“** (mit Baujahren). Felder: Name, Slug (leer lassen, dann aus dem Namen gebildet; nur änderbar, solange nichts darauf verweist), Land (ISO-Code, z. B. DE), Beliebt, Reihenfolge, Aktiv.
- **Bearbeiten**, **Deaktivieren** / **Aktivieren** (über das Aktionsmenü einer Zeile): Deaktivierte Einträge verschwinden aus der Auswahl der App; bestehende Builds behalten sie.
- **Löschen:** nur, wenn nichts verweist. Bestätigung mit **LÖSCHEN**.
- **Zusammenführen** (Duplikate, Tippfehler):
  1. Aktionsmenü → **„Zusammenführen“**.
  2. Unter **„Bleibt bestehen“** den Eintrag wählen, der bleibt. Bei Modellen nur Modelle derselben Marke, bei Generationen nur Generationen desselben Modells.
  3. Das Admin zeigt die Auswirkung: wie viele Fahrzeuge, Modelle, Generationen wechseln. Der alte Slug leitet danach auf den bleibenden Eintrag weiter.
  4. Begründung, **„Zusammenführen“**. Betrifft es mehr als 100 Fahrzeuge (in 24 Stunden), heißt die Schaltfläche **„Freigabe anfragen“**.
  Das Umhängen der Fahrzeuge läuft danach im Hintergrund.

**Anfragen:** Wenn ein Mitglied sein Auto nicht im Katalog findet, landet sein freier Text hier (Offen · Übernommen · Abgelehnt).

- **Übernehmen:** pro Ebene (Marke, Modell, Generation) **„Aus dem Katalog“** wählen, **„Neu anlegen“** oder **„Ohne“**. Das Fahrzeug des Mitglieds wird verknüpft; das Mitglied bekommt „Dein Fahrzeug ist jetzt im Katalog“.
- **Ablehnen:** **„Begründung für das Mitglied“** (10 bis 500 Zeichen; das Mitglied liest sie in der App). Sein Fahrzeug behält den freien Text.

**Export:** **„CSV exportieren“**.

### 9.2 Mod-Kategorien und Felder

**Katalog → Mod-Kategorien.** Die Kategorien und Felder des Mod-Formulars in der App. **Jede Änderung wird eine neue Schema-Version** und braucht eine Begründung.

- **„Neue Kategorie“**: Schlüssel (Kleinbuchstaben, Ziffern, `_`), Name DE/EN, Symbol, Reihenfolge (1 bis 63), Aktiv.
- In einer Kategorie die Reiter **Felder · Vorschau · Versionen**.
- **„Neues Feld“**: Schlüssel (z. B. `diameter_rear`), Bezeichnung DE/EN, Typ, Einheit, Min/Max/Schritt, Optionen (Wert + Bezeichnung DE/EN), Pflicht. **Suche** und **Filter** sind nur lesbar: Die Filter in Discover sind in dieser Version fest.
- **Felder mit Daten** werden **archiviert**, nie gelöscht (**„Archivieren“**): Neue Mods bekommen das Feld nicht mehr angeboten, bestehende Werte bleiben sichtbar und im Export. Archivierte Felder sind nie Pflicht und lassen sich wiederherstellen.
- Bei einem Feld mit Daten sind **Schlüssel und Typ gesperrt**. Engere Grenzen oder weniger Optionen lehnt das Admin ab, wenn gespeicherte Werte dann ungültig wären, und nennt die Anzahl.
- Felder ohne Daten kannst du löschen.
- **Reihenfolge:** Felder verschieben, **„Neue Reihenfolge speichern“** (auch eine neue Version).
- **Vorschau:** So sieht das Formular für Mitglieder aus (Deutsch/Englisch). Nichts hier wird gespeichert.
- **Versionen:** jede Version mit Vorher/Nachher.

### 9.3 Teilemarken

**Katalog → Teilemarken:** Marken von Teilen, die Mitglieder beim Eintragen einer Mod vorgeschlagen bekommen.

- **„Neue Teilemarke“**, **Bearbeiten**, **Aliase** (andere Schreibweisen, Enter fügt hinzu, höchstens 20).
- **„Normalisieren“**: findet Marken, die ohne Groß-/Kleinschreibung, Akzente und Satzzeichen gleich sind (z. B. „Akrapovic“ und „Akrapovič“), und schlägt die genauere Schreibweise als bleibende vor. Nichts ändert sich, bis du **„In … zusammenführen“** klickst.
- **Zusammenführen** wie in 9.1; Name und Aliase des alten Eintrags werden Aliase des bleibenden.

### 9.4 CSV-Import mit Probelauf

**Katalog → CSV-Import** (Recht: Katalog importieren). Ein Import benennt nichts um und löscht nichts.

1. **„Vorlage Fahrzeuge“** oder **„Vorlage Teilemarken“** herunterladen und ausfüllen (UTF-8 oder Excel-CSV, getrennt mit Semikolon oder Komma). Einträge werden über den Slug gefunden, auch über zusammengeführte.
2. Unter **„Datei prüfen“** den **Inhalt** wählen (Fahrzeuge / Teilemarken), **„Datei wählen“**, **„Prüfen“**.
3. **Probelauf:** „Ergebnis der Prüfung“ zeigt jede Zeile als **Neu**, **Geändert**, **Unverändert** oder **Fehler** mit Grund. Die Prüfung ändert nichts. Filtere mit „Zeilen zeigen“.
4. Fehler in der Datei korrigieren und neu prüfen, oder fortfahren: Zeilen mit Fehler bleiben einfach liegen.
5. **„… Zeilen übernehmen“** → bestätigen. Bei mehr als 100 geänderten Zeilen (in 24 Stunden) heißt die Schaltfläche **„Freigabe anfragen“**.
6. Der Import läuft im Hintergrund mit Fortschrittsanzeige. Danach „Übernommen am … von …“, oder eine Liste der Zeilen, die nicht übernommen wurden, mit Grund.

Die Datei wird 30 Tage aufbewahrt; danach muss sie für ein Übernehmen neu hochgeladen werden. **„Letzte Importe“** zeigt den Verlauf.

Bildschirm: `reports/visual/phase-3/ADM-17-apply__1280x800__carbon__de.png`.

---

## 10. QR

**QR → QR-Codes:** jeder Sticker-Code mit Status, Fahrzeug, Besitzer, erstellt, Scans 7/30 Tage. Ansichten: Aktiv · Gesperrt · Meiste Scans. Gezählt werden nur Scans pro Tag, keine Personen.

Detailseite: Diagramm „Wie oft wird der Sticker gescannt?“ (30 oder 90 Tage), **Verlauf** (erstellt, gesperrt, ersetzt, von wem), weitere Codes desselben Fahrzeugs.

Aktionen (Recht: QR-Codes sperren, im Auslieferungszustand Owner und Admin; Begründung Pflicht):

- **Sperren:** Ein Scan zeigt dann „nicht mehr gültig“, und der Besitzer kann selbst keinen neuen Code ausgeben, nur das Team. Der Besitzer bekommt eine E‑Mail.
- **Neu ausgeben:** Der aktive Code wird ersetzt; alte Sticker funktionieren nicht mehr. Der Besitzer bekommt eine E‑Mail.

---

## 11. Moderation

Meldungen kommen aus der App, vom Webformular `/melden` und aus Schlagwortregeln. **DSA-Fristen laufen ab Eingang: Schau an jedem Arbeitstag in die Warteschlange.** Eine Person aus dem Team entscheidet jeden Fall.

### 11.1 Meldungen (Warteschlange)

**Moderation → Meldungen**, Reiter:

- **Neu:** Fälle, die noch niemand übernommen hat.
- **In Prüfung:** Fälle, die gerade jemand prüft.
- **Entschieden:** die neuesten zuerst.
- **Einsprüche:** werden immer von einer anderen Person entschieden als die erste Entscheidung.

Spalten: **Priorität**, Inhalt (Profil, Fahrzeug, Foto, Nachricht, Update, Modifikation), Grund, Anzahl Meldender, erste/letzte Meldung, Zuständig, Status, gegebenenfalls KI-Vorschlag.

**Priorität** ist nachvollziehbar, nie eine Blackbox. Fahr mit der Maus darüber: Punkte für den Grund (Rechtswidrig vor Belästigung/Nacktheit vor Identitätsmissbrauch vor Spam vor Anderes), für mehrere Meldende, für frühere Entscheidungen gegen dasselbe Ziel in 12 Monaten (+5 je Entscheidung, höchstens 15) und für die Wartezeit (+1 je Tag, höchstens 10).

Filter: Suche (Fallnummer oder Inhalt), Inhalt, Grund, Zuständig (Ich / Niemand / Andere), Herkunft (App, Webformular, Automatisch erkannt, Eigeninitiative), Status.

- **„Übernehmen“** macht dich zuständig. Prüft ein anderes Teammitglied den Fall gerade, steht dort „… prüft diesen Fall gerade.“
- **Sammelaktion „Keine Maßnahme“** für Spamwellen: Die Fälle werden ohne Maßnahme abgeschlossen, Meldende erfahren das Ergebnis. Mehr als 100 Fälle in 24 Stunden brauchen eine Freigabe.

### 11.2 Fall

Ein Fall hat die Reiter **Inhalt · Meldungen · Beweise · Entscheidung · Frühere**. Aktionen oben: **Übernehmen**, **Übergeben** (an ein anderes Teammitglied; braucht „Über Meldungen entscheiden“), **Entscheiden**, **Zum Mitglied**.

- **Inhalt:** „So sehen Mitglieder es jetzt“. Nachrichten zeigt das Admin hier nicht, sondern nur im geschützten Bereich Nachrichten (11.5).
- **Meldungen:** alle Meldungen mit Grund, Angaben, Herkunft; Kontakt der meldenden Person nur, wenn sie ihn angegeben hat. Angaben, die eine Nachricht zitieren könnten, siehst du nur mit „Gemeldete Nachrichten lesen“.
- **Beweise:** was beim Melden gespeichert wurde. **„Beweise anzeigen“**; jedes Öffnen steht im Audit-Log.
- **Frühere:** frühere Entscheidungen zum Mitglied.

### 11.3 Entscheidung mit Begründungsvorlage

1. Im Fall **„Entscheiden“**. Es öffnet sich **„Entscheidung treffen“**.
2. **Maßnahme:**
   - **Keine Maßnahme:** Der Fall wird geschlossen. Wer gemeldet hat, erfährt das Ergebnis; das Mitglied erfährt nichts von der Meldung. Keine Begründung nötig.
   - **Inhalt entfernen:** Der Inhalt wird ausgeblendet; beim Profil Anzeigename, Kurzbeschreibung und Bilder.
   - **Einschränken:** Nachrichten oder Veröffentlichen sperren, mit oder ohne Ende (**„Was eingeschränkt wird“**, **Dauer**).
   - **Sperren:** Konto gesperrt; ein zweites Teammitglied muss freigeben.
3. **Vorlage** wählen. Vorlagen erscheinen in der Sprache des Mitglieds; Platzhalter werden ausgefüllt. Oder **„Ohne Vorlage“**.
4. **Sachverhalt** und **Grundlage** (Steht in: Community-Richtlinien / AGB / Gesetz, Abschnitt) prüfen und anpassen. Alles bleibt bis zum Senden änderbar.
5. **Automatisierte Mittel** sind nur lesbar: „Erkannt: automatisch (Schlagwortregel oder KI-Vorschlag)“ oder „Erkannt: durch eine Meldung oder das Team“, und immer „Entschieden: von dir, nicht automatisiert“.
6. **„Vorschau für das Mitglied“** → **„Vorschau aktualisieren“**: So sieht das Mitglied es in der App und in der E‑Mail, auf Deutsch und Englisch. Lies sie einmal ganz.
7. **Begründung** fürs Audit-Log, dann **„Entscheidung senden“** bzw. **„Sperre anfragen“**.

Meldende und betroffenes Mitglied werden benachrichtigt. Bildschirm: `reports/visual/phase-3/ADM-21-composer__1280x800__carbon__de.png`.

### 11.4 Einsprüche (durch eine andere Person)

Mitglieder können gegen eine Entscheidung Einspruch einlegen (intern binnen 6 Monaten), Meldende gegen eine „Keine Maßnahme“. Einsprüche stehen im Reiter **Einsprüche**.

1. Fall öffnen, im Reiter **Entscheidung** unter Einsprüche **„Einspruch entscheiden“**. Recht: Einsprüche prüfen.
2. Hast du die ursprüngliche Entscheidung selbst getroffen, geht das nicht („Ein anderes Teammitglied entscheidet den Einspruch.“). Gib den Fall dann ab.
3. **Ergebnis:**
   - **„Entscheidung bestätigen“:** Die Maßnahme bleibt.
   - **„Entscheidung ändern“:** Beim betroffenen Mitglied wird die Maßnahme aufgehoben, Inhalte kommen zurück. Beim Einspruch einer meldenden Person triffst du jetzt eine **Neue Maßnahme** zum gemeldeten Inhalt.
4. **„Begründung für die einspruchführende Person“** (10 bis 5.000 Zeichen; steht in der E‑Mail) und **„Interne Begründung (nur Audit-Log)“**.
5. **„Einspruch entscheiden“.** Alle Beteiligten werden benachrichtigt.

### 11.5 Nachrichten-Sicherheit

**Moderation → Nachrichten** (Recht: Gemeldete Nachrichten lesen). Nur **gemeldete** Nachrichten, Reiter **Offen** und **Entschieden**.

- Die Nachricht lädt erst, wenn du einen Fall öffnest. Du siehst **„Nachricht von @… an @…“**, die gemeldete Nachricht und den beim Melden gespeicherten Kontext. Jedes Öffnen wird protokolliert.
- **„Mehr Kontext laden (±10 Nachrichten)“** liest bis zu zehn Nachrichten davor und danach, so wie die meldende Person die Unterhaltung heute sieht. Das wird gesondert protokolliert. Mehr von der Unterhaltung ist nicht erreichbar.
- Entschieden wird wie in 11.3 (**„Fallseite“** öffnet den Fall).

### 11.6 Regeln

**Moderation → Regeln** (Recht: Wortlisten pflegen). Jede Änderung braucht eine Begründung.

**Schlagwörter** gelten für Fahrzeugbeschreibungen, Build-Notizen, Kurzbeschreibung und Anzeigename; Nachrichten werden nur markiert, nie gesperrt; private Mod-Notizen werden nicht geprüft. Es zählen ganze Wörter; Groß-/Kleinschreibung, Umlaute und Satzzeichen spielen keine Rolle.

- **„Begriff hinzufügen“** → Begriff und **Liste**:
  - **Sperren:** Der Text wird mit einem neutralen Hinweis abgelehnt (der Begriff wird dem Mitglied nicht genannt).
  - **Markieren:** Der Text wird gespeichert, und ein Fall entsteht zur Prüfung (Herkunft „Automatisch erkannt“).
- **„Entfernen“:** gilt sofort nicht mehr.
- Die Spalte „Treffer 30 Tage“ zählt nur Treffer, ohne Mitglied und ohne Text.

**Anfrage-Limits:** Abweichungen vom Standard für Limits wie Nachrichten, Meldungen, Uploads, zwischen 0,25× und 4×. **„Limits bearbeiten“** → Werte ändern (**„Standard“** setzt zurück) → Begründung → **„Veröffentlichen“**. Gilt für alle Mitglieder ab der nächsten Anfrage.

### 11.7 Begründungsvorlagen

**Moderation → Begründungsvorlagen** (ändern: Recht „Begründungsvorlagen pflegen“). Vorlagen für die Begründung nach Art. 17 DSA, auf Deutsch und Englisch.

- **„Neue Vorlage“**: Schlüssel (gleicher Schlüssel = gleiche Vorlage in der anderen Sprache), Sprache, **Für Maßnahme**, Name, Sachverhalt mit den Platzhaltern `{target}`, `{date}`, `{member}`, Grundlage (Steht in, Abschnitt), Reihenfolge.
- Die **Rechtsbehelfe** (interner Einspruch binnen 6 Monaten, außergerichtliche Streitbeilegung nach Art. 21 DSA, Gericht) sind vom Gesetz vorgegeben und nicht änderbar.
- Löschen einer Vorlage ändert schon gesendete Entscheidungen nicht.

---

## 12. Support

### 12.1 Tickets

**Support → Tickets:** Anfragen aus der App (Mitglieder) und vom Kontaktformular der Website. Spalten: Betreff, von wem, Kategorie, Status, zuständig, letzte Aktivität. Ansichten: Offen und wartend · Meine · Ohne Zuständige. Status: **Offen · Wartet · Erledigt**.

- **Zuständigkeit:** in der Liste oder im Ticket → Teammitglied wählen → **„Speichern“**.
- **Sammelaktion „Status ändern“**; mehr als 100 Tickets in 24 Stunden brauchen eine Freigabe.

### 12.2 Ein Ticket bearbeiten

Das Ticket zeigt den **Verlauf** (Antworten und interne Notizen sichtbar getrennt), Nummer, Eingang, Herkunft, Sprache und bei Mitgliedern **„Mitglied öffnen“**. Die Adresse eines Kontakts vom Webformular zeigt **„Anzeigen“** (protokolliert).

1. **„Antworten“** oder **„Interne Notiz“** wählen.
2. Optional **„Textbaustein einfügen“**; der Text bleibt änderbar.
3. Unter **„Danach“** den Status nach dem Senden wählen.
4. **„Antwort senden“** bzw. **„Notiz speichern“**.

- Mitglieder lesen die Antwort in der App unter **Einstellungen → Hilfe & FAQ → Deine Anfragen** und bekommen eine Mitteilung. Kontakte vom Webformular bekommen eine E‑Mail.
- Antworten unterschreibt immer „das Team“, nie eine Person; Mitglieder sehen keinen Namen aus dem Team.
- **Interne Notizen** werden nie gesendet.
- Ein **erledigtes** Ticket öffnet sich durch eine neue Antwort nicht von selbst; ändere dazu den Status.

### 12.3 Textbausteine

**Support → Textbausteine** (ändern: Recht „Textbausteine pflegen“). **„Neuer Textbaustein“**: Schlüssel (gleicher Schlüssel = gleicher Baustein in der anderen Sprache), Sprache, Titel, Text mit den Variablen `{name}` und `{reference}`, Reihenfolge.

---

## 13. Marke & Inhalte

### 13.1 Entwurf → Vorschau → Veröffentlichen → Zurücksetzen

Marke & Theme, Startseite und Ankündigungen (und in 14.2 die Remote-Konfiguration) arbeiten mit **Versionen**. Unten auf der Seite steht dafür eine Leiste mit dem Stand („Live: v…“, „Entwurf v…“):

1. **Ändern:** Deine Änderungen sind zuerst „Nicht gespeichert“. **„Entwurf speichern“** sichert sie als Entwurf. **„Änderungen verwerfen“** nimmt nicht gespeicherte Änderungen zurück, **„Entwurf verwerfen“** löscht den ganzen Entwurf. Live ändert sich dabei nichts.
2. **Ein Entwurf pro Bereich:** Hat jemand anderes schon einen Entwurf, siehst du „Entwurf von …“ und kannst ihn ansehen, aber nicht bearbeiten. Stimmt euch ab; einen fremden Entwurf verwerfen geht nur mit Begründung.
3. **Vorschau:** **„Vorschau“** oder **Marke & Inhalte → Entwurfsvorschau** zeigt App (Start, Fahrzeug) und die öffentliche Fahrzeugseite **mit deinen Entwürfen**, im Handy-Rahmen (390 px) und am Rechner (1280 px), in den Themes **Carbon**, **Schwarz** und **Hell**. Entwürfe anderer erscheinen dort nicht. Der Vorschau-Link gilt 15 Minuten (**„Neu laden“**) und ist schreibgeschützt. Hier wird nichts veröffentlicht.
4. **Veröffentlichen:** **„Veröffentlichen“** → **Begründung** → bestätigen. Der Entwurf wird die neue Live-Version; App und Website holen sie **innerhalb von 5 Minuten**.
5. **Zurücksetzen (Rollback):** **Marke & Inhalte → Versionsverlauf** → Bereich wählen (Marke & Theme, Startseite, Ankündigungen, Remote-Konfiguration) → Version wählen; das Admin zeigt die Änderungen gegenüber der vorigen Version. **„Auf v… zurückrollen“** → Begründung → **„Zurückrollen“**. Das veröffentlicht eine Kopie der alten Version als neueste Version; der Verlauf bleibt vollständig. Ein offener Entwurf wird dabei nicht verändert.

Bildschirm: `reports/visual/m3.5-a/phase-3/ADM-34__1280x800__carbon__de.png`.

### 13.2 Marke & Theme

**Marke & Inhalte → Marke & Theme** (Recht: Marke und Design pflegen).

- **Logo-Set:** Schriftzug weiß, Schriftzug schwarz, Quadratisches Logo, App-Symbol. Nur die Logos des Kunden, nie nachgebaut oder umgefärbt; PNG oder WebP mit Transparenz.
- **Startbilder:** Willkommen (App), Startseite (Web), Ladebildschirm. **„Auswählen“** → hochgeladenes Bild wählen oder **„Neues Bild hochladen“** (JPEG, PNG oder WebP, Mindestgröße wird angezeigt; Metadaten wie Standort werden entfernt). **Klick ins Bild setzt den Bildmittelpunkt**, um den die App zuschneidet (auch mit Pfeiltasten). „So schneidet das Handy zu“ zeigt das Ergebnis.
- **Kontrastprüfung:** Für das Willkommensbild misst das Admin, ob Logo und Text lesbar bleiben (mindestens 4,5:1). Reicht der Kontrast nicht („Zu wenig Kontrast“), lässt sich der Entwurf nicht speichern; nimm ein anderes Foto oder einen anderen Bildmittelpunkt.
- **Vorschaubild für Links:** erscheint, wenn eine Seite ohne eigenes Bild geteilt wird (1200 × 630 px).
- **Akzentfarbe:** nur geprüfte Farbsätze (Standard, Signalrot, Glutorange, Rennblau, Boxengrün); jeder erfüllt die Kontrastregeln in allen drei Themes. Freie Farbwerte sind bewusst nicht möglich.
- **Standard-Theme** für neue Installationen: Carbon, Schwarz, Hell oder Wie das Gerät. Mitglieder können es jederzeit selbst ändern.

Dann Vorschau und Veröffentlichen wie in 13.1. Bildschirm: `reports/visual/m3.5-a/phase-3/ADM-28__1280x800__carbon__de.png`.

### 13.3 Startseite

**Marke & Inhalte → Startseite** (bearbeiten: Inhalte bearbeiten; veröffentlichen: Inhalte veröffentlichen).

- **Featured Builds:** **„Build hinzufügen“** (Suche nach Marke, Modell oder @Name), Reihenfolge, Zeitraum oder ohne Ende; höchstens 8 gleichzeitig live.
- **Sammlungen** (Reihen in Entdecken): **„Sammlung anlegen“**, Schlüssel (später nicht mehr änderbar), Titel DE/EN, **Inhalt**: **Filter** (wie in der Adresse von Entdecken, z. B. `make=bmw&power_min=340`; alle passenden Builds, auch neue) oder **Handverlesen** (genau die Builds, die du auswählst). Hinweis: Handverlesene Sammlungen werden gespeichert, erscheinen in Entdecken aber erst, wenn Entdecken sie anzeigen kann.
- Ohne veröffentlichte Version gilt die mitgelieferte Liste.

### 13.4 Ankündigungen

**Marke & Inhalte → Ankündigungen:** Hinweise oben auf Start und in der Web-App. **„Ankündigung anlegen“**: Titel und Text DE/EN, **Ton** (Hinweis; **Warnung** nur, wenn etwas nicht funktioniert oder Mitglieder handeln müssen), optional **„Mit Schaltfläche“** (Beschriftung DE/EN, Ziel: Pfad in der App wie `/settings/help` oder `https://`-Adresse), **Für wen** (Alle, auch Gäste · Neue Mitglieder, letzte 14 Tage · Mitglieder mit Fahrzeug), **Zeitraum** (leer: ab sofort, ohne Ende), „Mitglieder können sie schließen“ oder „Bleibt stehen“. Veröffentlichen wie in 13.1.

### 13.5 Rechtstexte mit erneuter Zustimmung

**Marke & Inhalte → Rechtstexte:** Impressum, AGB, Datenschutz, Community-Richtlinien und Lizenzen je Sprache, mit allen Versionen.

1. Dokument und Sprache wählen, **„Neuer Entwurf“**.
2. **Version** eintragen (neu für dieses Dokument, z. B. `2` oder `2026-11`), Text in **Markdown** schreiben, **„Vorschau“** prüfen. Platzhalter wie `[[company_name]]` füllt der Server aus den Angaben zur Organisation (18.2).
3. Bei AGB und Datenschutz: **„Erfordert erneute Zustimmung“** anhaken, wenn sich für Mitglieder etwas Wesentliches ändert, und unter **„Was ändert sich?“** kurz und verständlich zusammenfassen (steht im Zustimmungsfenster der App).
4. **Veröffentlichen** (nur Owner oder Admin, Recht „Rechtstexte veröffentlichen“; die Redaktion schreibt Entwürfe):
   - **Ohne** erneute Zustimmung: „Text veröffentlichen?“ → bestätigen. App und Website zeigen die neue Fassung sofort.
   - **Mit** erneuter Zustimmung: **„Freigabe anfragen“**. Eine zweite Person prüft genau diesen Text; bis zur Freigabe ist er nicht mehr änderbar. Nach der Freigabe müssen **alle Mitglieder beim nächsten App-Start zustimmen**. Bis dahin können sie lesen, aber nichts schreiben; Datenexport, Kontolöschung und Support bleiben möglich. Wer ablehnt, wird abgemeldet.
5. **„Entwurf verwerfen“** löscht nur den Entwurf; veröffentlichte Versionen bleiben.

Rechtstexte haben keinen Rollback: Eine Korrektur ist eine neue Version.

### 13.6 Hilfe

**Marke & Inhalte → Hilfe:** Hilfeartikel der App und der Website je Sprache. **„Artikel anlegen“**: Schlüssel (gleich für DE und EN, z. B. `qr-sticker`), Kategorie, Titel, Text. **Veröffentlichen** / **Zurückziehen** pro Artikel. Achtung: Ein veröffentlichter Artikel ändert sich für Mitglieder **sofort beim Speichern**; Hilfeartikel haben keinen Entwurf und keinen Versionsverlauf. **Löschen** lässt sich nicht rückgängig machen.

### 13.7 E‑Mail- & Push-Vorlagen

**Marke & Inhalte → E‑Mail- & Push-Vorlagen:** alle Texte, die die Plattform verschickt.

1. Links eine Vorlage wählen (E‑Mails oder Push-Mitteilungen).
2. Felder anpassen. Leere Felder nutzen den Standardtext; erlaubt sind nur die Variablen des Standardtexts. Bei Mehrzahlformen bleibt die Anzahl der Formen gleich.
3. **„Vorschau mit Beispieldaten“** prüfen.
4. **„Speichern“**: gilt ab dem nächsten Versand.
5. **„Test an mich senden“** schickt die Vorlage mit Beispieldaten an deine eigene Adresse (nur an deine).
6. **„Auf Standard zurücksetzen“** löscht die Anpassungen dieser Sprache.

Anmelde-, Sicherheits- und Entscheidungstexte sind durch Code, Recht oder DSA festgelegt: **„Fest vorgegeben“**, nur zu lesen.

---

## 14. Konfiguration

### 14.1 Feature-Flags

**Konfiguration → Feature-Flags** (Recht: Feature-Flags schalten). Schalter für Funktionen.

- Wirksam ist nur die Spalte **„Hier“** (die Umgebung, in der du gerade bist). Die anderen Umgebungen (Lokal, Staging, Produktion) haben eigene Datenbanken; ihre Spalten zeigen nur den geplanten Stand.
- **„… bearbeiten“** → Beschreibung, An oder aus je Umgebung, **„Nur für das Team“** (Mitglieder sehen die Funktion nicht), **„Anteil der Mitglieder“** (0 bis 100 %; die Auswahl ist pro Mitglied fest), **„Kritisch“** → **„Änderung speichern“**.
- **Kritische Flags in Produktion** ändern sich erst nach einer Freigabe. Bis dahin bleibt das Flag, wie es ist („Wartet auf Freigabe“).
- **KI-Flags** (`ai.*`) lassen sich nicht einschalten, solange kein KI-Anbieter eingerichtet ist (siehe 20).
- Jede Änderung steht mit Vorher/Nachher im Audit-Log.

### 14.2 Remote-Konfiguration und Wartungsmodus

**Konfiguration → Remote-Konfiguration** (Recht: Remote-Konfiguration pflegen). Arbeitet mit Entwurf und Veröffentlichen wie 13.1; jede Änderung bestätigst du mit deinem Passwort.

- **App-Versionen** je Plattform (iOS, Android): **Mindestversion** (darunter fordert die App zum Update auf und lässt sich nicht mehr nutzen) und **Aktuelle Version** (darunter erscheint ein Hinweis). Darunter steht der letzte Produktions-Build aus dem Release-Register zur Orientierung.
- **Hinweis zum Aktualisieren** DE/EN (leer: mitgelieferter Text).
- **Wartungsmodus:** **„Wartungsmodus an“** + Hinweis DE/EN (Pflicht: Was ist los, wann geht es weiter?). Mitglieder sehen dann nur den Wartungshinweis.
  - **Einschalten braucht eine Freigabe** (Schaltfläche „Freigabe anfragen“). Plane also eine zweite Person ein.
  - **Ausschalten wirkt sofort** (Entwurf ohne Wartung veröffentlichen).
  - Das Team sieht die App während der Wartung über die **Entwurfsvorschau** (13.1) wie gewohnt.
  - Ein Rollback auf eine Version mit Wartung an braucht ebenfalls eine Freigabe.

Bildschirm: `reports/visual/m3.5-a/phase-3/ADM-37__1280x800__carbon__de.png`.

### 14.3 Release-Register

**Konfiguration → Release-Register** (Recht: Releases pflegen): alle Builds mit Version, Build-Nummer, Plattform, Kanal (LAN, Staging, Produktion), SHA-256 der APK, Notizen, Datum, Herkunft.

- **„Aus RELEASES.md übernehmen“** liest die Release-Liste, die mit dem Server-Paket kommt, und trägt neue Builds ein (doppelte nie).
- **„Build eintragen“** von Hand: Version (z. B. `1.0.0`), Build-Nummer, Plattform, Kanal, SHA-256 (64 Zeichen, wie das Build-Skript sie ausgibt), Datum, Notizen.
- Eintrag korrigieren über das Aktionsmenü, optional mit Grund.
- Die Prüfsumme kopierst du per Klick, um sie Testern mitzugeben.

---

## 15. Team & Rollen

Im Auslieferungszustand haben nur Owner und Admin hier Rechte.

### 15.1 Team einladen

**Team & Rollen → Team** zeigt alle Teammitglieder mit Rollen, Status (Aktiv · Eingeladen · Gesperrt · Deaktiviert · Gelöscht), Zwei-Faktor, letzter Anmeldung, und oben „Owner: … · höchstens 3“.

1. **„Einladen“**.
2. Name, E‑Mail-Adresse, **Sprache der E‑Mail**, **Rollen** (du kannst nur Rollen vergeben, deren Rechte du selbst hast; Owner lädt nur ein Owner ein).
3. Admin, Owner und Rollen mit kritischen Rechten gelten erst **nach einer Freigabe**; bis dahin hat das Konto nur die übrigen Rollen. Dann ist die **Begründung** Pflicht.
4. **„Einladung senden“.** Die Person bekommt den Link (72 Stunden, einmal) und folgt 2.1 bis 2.4.

Abgelaufene Einladung: Teammitglied öffnen → **„Einladung erneut senden“** → **„Neu senden“**.

### 15.2 Teammitglied verwalten

Teammitglied öffnen: Reiter **Rollen & Rechte** (Rollen und die Rechte daraus) und **Sicherheit & Sitzungen** (Zwei-Faktor, Sitzungen). Aktionen:

- **Rollen ändern:** Rollen wählen; das Admin zeigt **„Neue Rechte“** und **„Entfallende Rechte“**. Normale Änderungen gelten sofort (**„Rollen speichern“**). Bei Admin, Owner, kritischen Rechten, einem Owner-Konto oder dem Wegnehmen von Admin heißt die Schaltfläche **„Freigabe anfragen“** und das Admin nennt den Grund. Bei deinem eigenen Konto kannst du Rollen nur abgeben, nicht hinzufügen.
- **Deaktivieren:** Alle Sitzungen enden sofort, auch Einladungslinks und gestartete Ansichten als Mitglied. Die Rollen bleiben für eine Reaktivierung. Owner und Admin nur nach Freigabe. Der letzte aktive Owner lässt sich nicht deaktivieren.
- **Reaktivieren:** Zugang mit bisherigen Rollen, Passwort und Zwei-Faktor zurück (Owner-Konten mit Freigabe).
- **Löschen:** nur deaktivierte Konten. Name, Adresse, Passwort, Zwei-Faktor und Rollen werden entfernt; im Audit-Log heißt das Konto dann „Gelöschtes Teammitglied“. Unumkehrbar.
- **Alle Sitzungen beenden:** jede Anmeldung des Kontos endet sofort.
- **Zwei-Faktor zurücksetzen:** für eine verlorene Authenticator-App (siehe 22.3). Nur ein Owner fragt an, ein zweiter Owner gibt frei.

Ein Owner-Konto ändert nur ein Owner. Dein eigenes Konto verwaltest du unter **Mein Konto** (18.1).

### 15.3 Rollen

**Team & Rollen → Rollen:** die sechs Grundrollen (Name bleibt) und eigene Rollen.

- **„Rolle anlegen“**: Name (3 bis 60 Zeichen), Beschreibung, Rechte. Kritische Rechte (mit Vier-Augen-Symbol) gelten erst nach Freigabe; dann ist die Begründung Pflicht und die Schaltfläche heißt **„Speichern und Freigabe anfragen“**.
- **Bearbeiten**, **Löschen** (nur wenn niemand die Rolle mehr hat).
- Owner und Admin haben immer alle Rechte („Hat alle Rechte“).

### 15.4 Rechte-Matrix

**Team & Rollen → Rechte-Matrix:** Rollen × Rechte, nach Bereichen gruppiert.

1. Kästchen setzen oder entfernen. Oben steht die Anzahl der Änderungen.
2. **„Änderungen prüfen“**: Das Admin zeigt je Rolle, was **Neu** dazukommt und was **Entfällt**, und **wie viele Personen** betroffen sind.
3. **„Speichern“**. Entzogene und unkritische Rechte gelten sofort. Kommen kritische Rechte dazu, heißt die Schaltfläche **„Freigabe anfragen“**; die ganze Änderung gilt dann erst, wenn eine zweite Person freigibt, die keine der betroffenen Rollen hat.
4. **„Verwerfen“** nimmt alles zurück.

Ändern darf nur, wer „Rollen und Rechte verwalten“ hat. Die Spalten Owner und Admin sind fest („immer“). Ein Update des Servers macht deine Änderungen an der Matrix nie rückgängig.

### 15.5 Freigaben

**Team & Rollen → Freigaben**: siehe 4.3.

---

## 16. Audit & Datenschutz

### 16.1 Audit-Log

**Audit & Datenschutz → Audit-Log** (Recht: Audit-Log ansehen). Jede Änderung durch das Team und jeder Zugriff auf sensible Daten, fälschungssicher verkettet. **Einträge lassen sich nicht ändern oder löschen.**

- Spalten: Nr., Zeitpunkt, Wer (System, Team, Mitglied), Aktion, Ziel, Begründung.
- Filter: Wer, **„Aktion beginnt mit“** (z. B. `approval.`), Ziel-Typ, Ziel-ID, Von/Bis. Ansichten: Nur Team · Freigaben · Team-Sicherheit.
- Zeile anklicken: Ereignis mit **Vorher / Nachher**, Anfrage-ID und Hash. Auch dieses Öffnen wird vermerkt.
- **Integrität:** Oben steht **„Integrität geprüft: …“** (die Kette wird jede Nacht um 02:00 geprüft). Steht dort **„Kette unterbrochen bei Nr. …“**: **Informiere sofort einen Owner und ändere nichts an der Datenbank.**
- **Export:** **„Exportieren“** → Format **CSV** oder **JSONL** → **„Freigabe anfragen“** (Vier-Augen). Download 24 Stunden lang (4.3).

IP-Adresse und Browser der Teammitglieder zu Audit-Ereignissen werden getrennt gespeichert und nach der eingestellten Frist gelöscht (16.3).

### 16.2 DSGVO-Anfragen mit Fristen

**Audit & Datenschutz → DSGVO-Anfragen** (ansehen: DSGVO-Anfragen ansehen; bearbeiten: DSGVO-Anfragen bearbeiten). Arten: **Auskunft · Datenexport · Löschung · Berichtigung · Widerspruch · Einschränkung**.

**Fristen (Art. 12 Abs. 3 DSGVO):** Antwort **innerhalb eines Monats** nach Eingang; **einmal** um **zwei Monate** verlängerbar, mit Grund und vor Ablauf der ersten Frist. Die Liste ist nach Fälligkeit sortiert und zeigt „noch … Tage“, „heute fällig“ oder „… Tage überfällig“. Ansichten: Offen · Frist ≤ 7 Tage · Überfällig · Mir zugewiesen. Fristen ≤ 7 Tage erscheinen auch als Warteschlange auf dem Dashboard.

Anfragen, die Mitglieder in der App selbst erledigt haben (Datenexport, Kontolöschung), stehen unten unter **„In der App selbst erledigt“**, nur zur Übersicht.

**Ablauf:**

1. **„Anfrage erfassen“**: Art, **Eingegangen per** (E‑Mail, Brief, Support-Ticket, anderer Weg), **Von wem** (Mitglied per Benutzername oder externe Person mit Name und E‑Mail), Eingangsdatum (leer = heute), Inhalt. **„Anfrage anlegen“.** Die Frist beginnt mit dem Eingang.
2. Reiter **Anfrage**: **Zuständig** und **Status** setzen (Offen → In Bearbeitung ⇄ Wartet auf Antwort), **„Übernehmen“**.
3. Reiter **Antworten**: **Vorlage** wählen (Eingangsbestätigung · Bitte um Identitätsnachweis · Verlängerung der Frist · Erledigt · Ablehnung mit Rechtsbehelf), Sprache, optional **Eigener Absatz**, **„Antwort senden“**. Gespeichert wird nur, dass gesendet wurde, nicht der Text.
4. Je nach Art:
   - **Auskunft / Datenexport:** **„Export senden“**. Prüfe vorher die Identität. Das Mitglied bekommt seinen Datenexport wie in der App per E‑Mail, mit einem Link, der 7 Tage gilt. Das Team sieht die Datei nicht.
   - **Löschung:** **„Löschung anfragen“** (Vier-Augen, Recht „Mitglieder löschen“). Nach der Freigabe wird das Konto sofort geschlossen und innerhalb von 30 Tagen endgültig gelöscht.
   - **Berichtigung / Widerspruch / Einschränkung:** im jeweiligen Bereich erledigen (z. B. Mitgliedsprofil bearbeiten) und das im Nachweis beschreiben.
   - **Frist verlängern** (nur einmal, vor Ablauf): **„Frist verlängern“** → Grund → danach die Antwort „Verlängerung der Frist“ senden.
5. Reiter **Abschluss**: **Ergebnis** Erledigt oder Abgelehnt, **Nachweis** als **Notiz** (was getan wurde und wann, 10 bis 5.000 Zeichen) und/oder **Datei** (PDF, Bild, Text oder ZIP, bis 10 MB). Eine Ablehnung braucht die Gründe als Notiz und danach die Antwort „Ablehnung mit Rechtsbehelf“. **„Abschließen“** bzw. **„Ablehnen“**.

Abgeschlossene Anfragen bleiben mit Nachweis so lange, wie unter Aufbewahrung eingestellt.

### 16.3 Aufbewahrung

**Audit & Datenschutz → Aufbewahrung** (ändern: Recht „Aufbewahrungsfristen ändern“). Wie lange Daten bleiben, bevor die täglichen Aufräumjobs sie löschen.

- **Einstellbar** (jeweils mit erlaubtem Bereich und Standard): Gelöschte Konten, Gelöschte Fahrzeuge, Gelöschte Fotos, Unbestätigte Konten, Bekannte Geräte, Support-Tickets, IP-Adressen im Audit-Log, DSGVO-Anfragen. Jeder Wert liegt zwischen dem gesetzlichen oder technischen Minimum und dem, was die Datenschutzerklärung zusagt.
- **Fest** (technisch, gesetzlich oder vom Hosting vorgegeben): Bestätigungscodes, Schutz vor doppelten Anfragen, abgelaufene Anmelde-Tokens, Nachrichten gelöschter Mitglieder, Audit-Ereignisse und Archiv, Moderationsfälle, QR-Scans (nur Summen), Server-Protokolle.
- Werte ändern → **„Speichern“** → Begründung → bestätigen. Gilt ab dem nächsten Lauf der Aufräumjobs.

Hinweis: Die Fristen für DSGVO-Anfragen und Moderationsfälle (je 36 Monate) prüft noch die Rechtsberatung.

---

## 17. System

Im Auslieferungszustand für Owner und Admin.

### 17.1 Systemzustand

**System → Systemzustand:** Prüfungen von Datenbank, Cache, Warteschlange, fehlgeschlagenen Jobs, Zeitplaner, Speicherplatz, Speicher-Verknüpfung, Bildverarbeitung (WebP), PHP-Version und -Erweiterungen, E‑Mail, Pusher, KI-Anbieter, letztem Backup und Audit-Kette. Status: In Ordnung · Warnung · Fehler · Abgestürzt · Übersprungen · Noch nicht geprüft.

Die Prüfungen laufen alle fünf Minuten; **„Jetzt prüfen“** startet sie sofort. Fehler gehen zusätzlich per E‑Mail an die hinterlegte Betriebsadresse. Bei „Fehler“ informiere die technische Betreuung.

### 17.2 Jobs

**System → Jobs**, Reiter **Fehlgeschlagen** und **Wartend**. Das Admin zeigt nur Klassennamen, Warteschlange, Fehler und Zeiten, nie den Inhalt eines Jobs. Oben: „Zeitplaner zuletzt aktiv …“. Steht dort „Zeitplaner noch nie gesehen“, läuft der Cronjob nicht: technische Betreuung informieren.

Fehlgeschlagene Jobs auswählen (höchstens 100 auf einmal) → **„Erneut versuchen“** (zurück in die Warteschlange; innerhalb einer Minute aufgenommen) oder **„Verwerfen“** (gelöscht, nicht mehr ausgeführt). Recht: Jobs wiederholen oder verwerfen.

### 17.3 Integrationen

**System → Integrationen:** E‑Mail, Pusher, Push-Mitteilungen (Expo), KI-Anbieter, Cloudflare Turnstile, Sentry, jeweils **„Eingerichtet“** oder **„Nicht eingerichtet“**. Schlüssel, Server und Adressen zeigt das Admin nie.

Testknöpfe: **„Test-E‑Mail an mich“**, **„Test-Ereignis senden“** (Pusher), **„Test-Push an mein Gerät“** (nur aktiv, wenn für dein Team-Konto ein Gerät registriert ist; sonst mit Grund ausgegraut), **„KI-Aufruf testen“** (ohne Schlüssel antwortet eine Attrappe).

---

## 18. Einstellungen

### 18.1 Mein Konto

**Einstellungen → Mein Konto** (oder Menü oben rechts):

- **Profil:** Name, Adresse, Rollen, letzte Anmeldung. Ändern kann sie ein Owner oder Admin im Team.
- **Passwort ändern:** Aktuelles Passwort, Neues Passwort, wiederholen, **„Passwort ändern“**. Alle anderen Sitzungen enden; diese bleibt.
- **Zwei-Faktor-Schutz → „Authenticator wechseln“** (neues Telefon, andere App):
  1. **Aktueller Code** aus der bisherigen App → **„Weiter“**.
  2. QR-Code mit der neuen App scannen oder **Schlüssel** eingeben. Der Schlüssel wird nur einmal gezeigt; der Wechsel gilt 15 Minuten.
  3. **„Code aus der neuen App“** → **„Neuen Authenticator bestätigen“**.
  Bis zur Bestätigung gilt dein bisheriger Code weiter. Danach enden alle anderen Sitzungen. **„Abbrechen“** oder **„Neu anfangen“** jederzeit.
- **Wiederherstellungscodes:** siehe 2.4.
- **Sitzungen:** wo du angemeldet bist. **„Abmelden“** je Sitzung oder **„Alle anderen abmelden“**.

### 18.2 Organisation

**Einstellungen → Organisation** (sichtbar für Owner und Admin; **ändern nur ein Owner**): die Angaben zum Betreiber für Impressum, Rechtstexte und E‑Mails, gruppiert in Unternehmen, Kontakt, Register und Aufsicht, Sprache: Firmenname, Rechtsform, Straße, PLZ und Ort, vertretungsberechtigte und inhaltlich verantwortliche Person, Kontakt-, Support-, Datenschutz-, DSA-Kontakt- und Melde-E‑Mail, Telefon, Registergericht und -nummer, USt-IdNr., Aufsichtsbehörde, **Standardsprache** (für Mitglieder und Gäste ohne eigene Wahl).

Neben jedem Feld steht der Platzhalter, den es füllt (z. B. `[[company_name]]`). Oben: „… Angaben fehlen noch“. **„Speichern“** → bestätigen: Impressum, Rechtstexte und E‑Mails zeigen die neuen Angaben **sofort**. Solange nichts gespeichert ist, zeigen die Rechtstexte die Platzhalter.

---

## 19. Mitgliedschaften (nur wenn aktiviert)

Nur sichtbar, wenn das Flag **`premium.enabled`** an ist (im Auslieferungszustand aus) und du „Mitgliedschaften verwalten“ hast; dann stehen unter **Einstellungen** zusätzlich **Pläne** und **Freischaltungen**. Es ist ein Gerüst **ohne Zahlungen**: Digitale Premium-Inhalte laufen später über Apple- und Google-Käufe in der App.

- **Pläne:** **„Plan anlegen“**: Schlüssel (bleibt fest), Name DE/EN, Leistungen DE/EN (eine pro Zeile, höchstens 20), **„Aktiv: Kann freigeschaltet werden“**.
- **Freischaltungen:** **„Freischalten“**: Benutzername, Plan, Zeitraum (leer: ab heute, ohne Ende), Grund. **„Widerrufen“** beendet den Plan sofort; die Zeile bleibt als Verlauf. Alles steht im Audit-Log.

---

## 20. KI-Vorschläge

- **Die KI-Funktionen sind aus, solange kein KI-Anbieter eingerichtet ist.** In den Feature-Flags steht dann „Kein KI-Anbieter konfiguriert: KI-Flags bleiben aus, bis ein Anbieter mit Schlüssel eingerichtet ist (System → Integrationen).“ Den Schlüssel richtet der Betrieb auf dem Server ein (`docs/DEPLOY.md` 10); danach schaltet ein Owner oder Admin die gewünschten `ai.*`-Flags ein.
- Im Admin gibt es nur die **Prüfhilfe für Moderation** (`ai.moderation_triage`): An Fällen und Fotos erscheint **„KI-Vorschlag … %“** mit einer Zeile Begründung („Nur ein Vorschlag der KI, keine Entscheidung.“). Sie ändert weder Status noch Priorität noch eine Entscheidung.
- **Ein Mensch entscheidet immer.** Jede Entscheidung trägt „Entschieden: von dir, nicht automatisiert“. Wurde ein Fall durch automatisierte Mittel erkannt, nennt die Begründung an das Mitglied das (DSA).
- Die KI bekommt keine Nachrichteninhalte von Mitgliedern; das Protokoll der Aufrufe enthält keine Inhalte.

---

## 21. Was du nie tun kannst

Diese Grenzen sind fest eingebaut, für jede Rolle, auch für Owner:

- **Passwörter von Mitgliedern sehen oder setzen.** Es gibt nur „Code zum Zurücksetzen senden“ und „Passwortänderung erzwingen“. Temporäre Passwörter gibt es nicht.
- **Passwörter, Zwei-Faktor-Schlüssel oder Wiederherstellungscodes anderer Teammitglieder sehen.**
- **Nachrichteninhalte lesen**, außer der gemeldeten Nachricht mit ihrem Kontext in **Moderation → Nachrichten** (jedes Öffnen protokolliert). Der Reiter „Nachrichten“ im Mitgliedsprofil zeigt nur Zahlen.
- **In der Ansicht als Mitglied schreiben, Nachrichten sehen oder Push-Mitteilungen auslösen.**
- **Eine Datenkopie mit Nachrichten bekommen:** Der Team-Export eines Mitglieds enthält keine Nachrichten; die vollständige Kopie nach Art. 15 DSGVO geht nur an das Mitglied selbst.
- **IP-Adressen von Mitgliedern sehen.**
- **Eine Vier-Augen-Aktion allein ausführen**, die eigene Anfrage freigeben oder eine Anfrage freigeben, die dich selbst betrifft.
- **Dir selbst eine höhere Rolle geben** oder Rechte vergeben, die du selbst nicht hast.
- **Mehr als 3 Owner haben** oder den letzten aktiven Owner deaktivieren.
- **Audit-Einträge ändern oder löschen.**
- **Schlüssel und Zugangsdaten der Integrationen sehen**, oder den Inhalt eines Hintergrund-Jobs.
- **Freie Farben einstellen** oder Logos umfärben.
- **Katalogeinträge löschen, auf die etwas verweist**, oder Felder mit Daten löschen oder ihren Typ ändern.
- **Festgelegte Texte ändern:** Anmelde-, Sicherheits- und Entscheidungstexte, die Rechtsbehelfe in DSA-Begründungen.
- **Als Moderation länger als 30 Tage sperren.**
- **Einen Einspruch gegen die eigene Entscheidung entscheiden.**
- **Die KI entscheiden lassen.**

---

## 22. Wenn etwas nicht klappt

### 22.1 Freigabe abgelaufen

Nach 24 Stunden ohne Zustimmung steht die Anfrage auf **„Abgelaufen“**; nichts wurde ausgeführt. Starte die Aktion neu (neue Anfrage, neue Begründung) und sprich die freigebende Person direkt an. Steht dort **„Fehlgeschlagen“** („Freigegeben, aber nicht ausgeführt“), hat sich der Datensatz inzwischen geändert; prüfe ihn und frag bei Bedarf erneut an.

### 22.2 „Zu viele Versuche“ nach falschen Codes oder Passwörtern

Das Admin sperrt dich nicht dauerhaft, es bremst:

- **Zwei-Faktor-Code:** nach 5 falschen Codes in einer Minute „Zu viele Versuche. Warte kurz und versuche es dann erneut.“ Warte eine Minute. Prüfe die Uhrzeit deines Telefons (automatische Zeit an).
- **Anmeldung:** nach mehreren falschen Passwörtern wird jeder weitere Versuch langsamer. Nutze **„Passwort vergessen?“**, statt weiter zu raten.
- **Passwort bestätigen:** nach 5 falschen Eingaben innerhalb von 15 Minuten wartest du, bis die 15 Minuten um sind.
- Zeigt das Team dein Konto als **„Gesperrt“** oder **„Deaktiviert“**, endet jede Sitzung sofort; nur ein Owner oder Admin kann es reaktivieren.

### 22.3 Authenticator verloren

1. Melde dich mit einem **Wiederherstellungscode** an (**„Wiederherstellungscode verwenden“**). Jeder Code gilt einmal; streich ihn danach.
2. Bitte einen **Owner**, deinen Zwei-Faktor-Schutz zurückzusetzen: **Team** → dein Konto → **„Zwei-Faktor zurücksetzen“**. Ein **zweiter Owner** gibt frei (und keiner der beiden darf das Konto sein, um das es geht).
3. Danach enden alle deine Sitzungen. Setz über **„Passwort vergessen?“** ein neues Passwort, melde dich an und richte den Zwei-Faktor-Schutz neu ein (2.3, 2.4).

Wichtig: **„Authenticator wechseln“** unter Mein Konto verlangt einen Code aus der **bisherigen** App; ein Wiederherstellungscode reicht dafür nicht. Geht dein Telefon verloren, ist der Weg über die Owner (Schritt 2) der einzige. Verliert ein **Owner** sein Telefon, braucht es dafür **zwei andere Owner**. Haltet deshalb drei Owner und bewahrt Wiederherstellungscodes getrennt vom Telefon auf.

### 22.4 Weitere Meldungen

| Du siehst | Bedeutung, was tun |
|---|---|
| **„Seite nicht gefunden“** schon bei `/admin/login` | Du bist nicht im freigegebenen Netz (2.7). VPN oder Büro-Netz nutzen. |
| **„Kein Zugriff“** | Deiner Rolle fehlt das Recht. Owner oder Admin fragen. |
| **„Deine Sitzung ist abgelaufen“** | 30 Minuten inaktiv (2.5). Neu anmelden. |
| **„Seite abgelaufen“** (419) | Die Seite war zu lange offen. Neu laden, Aktion wiederholen. |
| Dialog **„Passwort bestätigen“** | Geschützte Aktion (2.6). Passwort eingeben; die Aktion läuft dann weiter. |
| **„Wartungsarbeiten“** | Der Server wird gewartet. Später erneut versuchen. |
| Ansicht als Mitglied öffnet keinen Tab | Pop-up-Blocker. Pop-ups für das Admin erlauben, erneut klicken. |
| **„Kette unterbrochen bei Nr. …“** im Audit-Log | Sofort einen Owner informieren, nichts an der Datenbank ändern. |
| **„Zeitplaner noch nie gesehen“** / Zeitplaner „Keine Rückmeldung“ | Der Cronjob läuft nicht: technische Betreuung informieren (`docs/DEPLOY.md` 5). |
