# Rechtstexte: Änderungen für SPEED CLUB 2.0 (Phase 4)

Entwurf – rechtliche Prüfung ausstehend (OA-35). Keine Rechtsberatung: Das Team hat die Texte so geschrieben, dass sie beschreiben, was die Software tatsächlich tut. Ob sie rechtlich genügen, entscheidet die anwaltliche Prüfung.

- **Quellen:** `web/database/data/legal/{privacy,terms,community,imprint}.{de,en}.md` (Seeder `LegalDocumentSeeder`, Verwaltung in ADM-31 „Rechtstexte“). Verbindlich ist die deutsche Fassung.
- **Platzhalter:** `[[…]]`. Firmendaten (zum Beispiel `[[Firmenname]]`, `[[Datenschutz-E-Mail]]`) füllt der Betreiber in den Organisationseinstellungen (ADM-52). Alle anderen `[[…]]` sind offene Entscheidungen für die Prüfung oder den Betreiber.
- **Stand:** 2026-11-13, Modul M4.18.

## 1. Wie die neue Fassung ausgeliefert wird

- **Neue Installation:** Der Seeder legt die neuen Texte als Version 1 an.
- **Bestehende Installation** (lokal, Staging): Die Migration `2026_12_09_100000_publish_phase_4_legal_drafts` veröffentlicht die neue Fassung als nächste Version (Begründung „Phase-4-Entwürfe … keine erneute Zustimmung“, Audit `legal.published`). Das passiert nur, wenn der bisher veröffentlichte Text noch ein unveränderter Seeder-Entwurf ist. Texte, die Mitarbeitende in ADM-31 geändert haben, bleiben, wie sie sind.
- **Keine erneute Zustimmung:** 08_LEGAL_COMPLIANCE schreibt keine automatische erneute Zustimmung vor. Sie wird in ADM-31 beim Veröffentlichen mit „erfordert erneute Zustimmung“ ausgelöst (Vier-Augen-Prinzip, ADR-236 f, ADR-245). Die Texte sind ungeprüfte Entwürfe, und die Produktion hat noch keine Mitglieder (OA-10). Deshalb fragt die Migration niemanden erneut.
  **Zu entscheiden:** ob die geprüfte Fassung vor dem Start mit „erfordert erneute Zustimmung“ veröffentlicht wird. Nötig ist das nur für Mitglieder, die schon einer älteren Fassung zugestimmt haben.
- **Versionsangabe:** Die Zeile „Version 1“ im Text ist entfallen. Die Seite zeigt Version und Datum aus der Datenbank an. „Stand: [[Datum]]“ bleibt für das Datum, das die Prüfung festlegt.

## 2. Datenschutzerklärung

Gliederung neu: 1 Verantwortlicher · 2 Daten (Tabelle) · 3 Öffentlich sichtbar · 4 Fotos · 5 QR-Codes · **6 Anmeldung und Kontosicherheit** · **7 Treffen** · **8 Karten und Ortssuche** · **9 Betriebe, Teilekatalog und Anzeigen** · **10 Web-App und Push im Browser** · **11 Vorschaubilder** · **12 Fehlerberichte** · 13 Cookies und Speicher · 14 Empfänger · 15 KI · 16 Speicherdauer · 17 Rechte · 18 Altersgrenze · 19 Änderungen.

| Änderung | Grund (was gebaut wurde) |
|---|---|
| Tabelle: Passwort nur, wenn eins festgelegt ist; neue Zeilen für E-Mail-Code und Link, Passkeys, Apple und Google | Auth 2.0 (ADR-407, 408, 429, 432): Anmeldung ohne Passwort. `login_attempts` speichert Adresse, Code und Link nur als Hash, ohne IP-Adresse. Passkeys speichern nur den öffentlichen Schlüssel. `social_accounts` speichert Kennung, E-Mail, Weiterleitungsadresse und bei Apple ein verschlüsseltes Token |
| § 6 Anmeldung und Kontosicherheit | M4.7 (ADR-433, 435): Geräte, Sitzungen und Sicherheitsaktivität ohne IP-Adresse; Installationskennung nur als HMAC; Warn-E-Mails lassen sich nicht abschalten; „Das war ich nicht“ gilt 7 Tage, einmal; App-Sperre nur auf dem Gerät; beim Löschen des Kontos wird Apple widerrufen |
| Ungefähre Stadt bei der Anmeldung als Platzhalter | GeoLite2 ist noch nicht lizenziert (OA-33). `approx_city` bleibt bis dahin leer |
| Region für „in deiner Nähe“ | `users.home_region_*`: Stadt und Punkt auf einem Raster von 0,05°, nie öffentlich |
| Wartung und Kosten | M4.13 (ADR-441): Kosten privat, Belegfotos privat hinter signierten Links, keine Ansicht für Mitarbeitende in „Ansicht als“ |
| Build-Updates, Reaktionen, Erwähnungen, Sammlungen, gefolgte Fahrzeuge | M4.11 (ADR-413, 436): Reaktionen sieht nur der Besitzer (Zahl und Liste), Erwähnungen nach Einstellung, Kommentare gebaut, aber ausgeschaltet |
| § 3 Öffentlich: Sichtbarkeit von Updates, private Reaktionen, Zahl der Zusagen öffentlich, Teilnehmerliste nur für auffindbare Mitglieder, Ort „nach Zusage“, Betriebsprofil mit Impressum, „Eingebaut von“ erst nach beidseitiger Zustimmung | ADR-437 b/c, ADR-414, AttendeeController |
| § 7 Treffen | M4.12 (ADR-437, 439): Vorabprüfung, Antworten für den Organisator sichtbar, Erinnerungen 24 h und 2 h (E-Mail nur nach Opt-in, ohne Ort), .ics öffentlich ohne privaten Ort, persönlicher Kalenderlink bis 2 Tage danach, Browser-Standort auf etwa 1 km gerundet und nicht gespeichert |
| § 8 Karten und Ortssuche | ADR-411, 449, 461 c: Karte erst nach einem Tippen, Kacheln von OpenFreeMap (erhält die IP-Adresse), Kartenbibliothek auf dem eigenen Server, Links zu openstreetmap.org; Nominatim über den eigenen Server (nur der Suchbegriff), Zwischenspeicher 30 Tage |
| § 9 Betriebe, Katalog, Anzeigen | M4.14 (ADR-414, 455, 461): Prüfung, Impressum nach § 5 DDG in der Verantwortung des Betriebs, Team nur per angenommener Einladung, Profilaufrufe nur als Tageszahl; Partnerlinks als „Anzeige“ (Flag `affiliate_links` aus), keine Klickzählung |
| § 10 Web-App und Push im Browser | M4.15 (ADR-415, 452, 456, 461 d): Service Worker speichert nur App-Dateien, keine API-Antworten, kein Tracking. Push über die Dienste von Google, Mozilla, Apple und Microsoft (`web_push.hosts`), Inhalt Ende-zu-Ende verschlüsselt (aes128gcm), Haltezeit 12 h, VAPID |
| § 11 Vorschaubilder | `OgImages`, `og:prune` täglich; beim Verbergen oder Löschen sofort entfernt |
| § 12 Fehlerberichte der App | `POST /api/v1/client-errors`: eigene Logdatei, 14 Tage, keine Eingaben, Mitglieds-ID |
| § 13 Speicher: Cookie `sc_browser` (5 Jahre), Entwürfe und Warteschlange, erweiterter Offline-Speicher, Android-Widget, Service Worker, Kartenkacheln | ADR-416, 435, 454; `known_devices.browser_cookie_days` = 1825 |
| § 14 Empfänger: zweite Tabelle für Stellen, die nur bei Nutzung einer Funktion Daten erhalten (Apple, Google, Push-Dienste der Browser, OpenFreeMap, OSM Foundation, externer Sticker-Shop) | Diese Stellen arbeiten nicht in unserem Auftrag. Die Einordnung ist zu prüfen |
| § 16 Speicherdauer: alle neuen Fristen (Tabelle unten) | Werte aus `config/speedclub.php` und den Löschbefehlen; der Pest-Test `Phase4LegalDraftsTest` vergleicht sie mit der Konfiguration |
| § 17 Rechte: Export mit den neuen Bereichen, sofortiges Entfernen der Anmeldewege beim Löschen, neue Einstellungen | `ExportContents` enthält Treffen, Wartung, Betrieb, Reaktionen, Geräte und Sicherheitsaktivität; `DeleteAccount` |
| Mitgliedschaft (noch nicht aktiv) | Gerüst `entitlements` (Flag `membership` aus), keine Zahlungsdaten |

### Speicherdauer laut Code

| Daten | Frist | Stelle im Code |
|---|---|---|
| E-Mail-Codes und Anmeldelinks | gültig 10 min, gelöscht nach 24 h | `speedclub.email_code.*`, `speedclub:prune-platform` (stündlich) |
| Anmeldevorgänge mit Passkeys | gültig 5 min, gelöscht in der folgenden Stunde | `passkeys.challenge_ttl_seconds`, `speedclub:prune-platform` |
| App-Installationen | 12 Monate nach der letzten Nutzung, wenn niemand mehr angemeldet ist | `known_devices.retention_months` |
| Sicherheitsaktivität (SET-21) | 12 Monate | `security_events.retention_months` |
| Sicherheitsereignisse im Audit-Protokoll | 24 Monate, Archiv bis 36 Monate | `audit.*` (unverändert) |
| Anmeldungen in der App | Ablauf nach 90 Tagen, Erneuerung alle 7 Tage bei Nutzung | `tokens.*` |
| Push im Browser | Ende der Sitzung, Abmeldung oder 30 Tage ohne Erneuerung; sofort bei 404/410; nach 5 Fehlversuchen | `web_push.orphan_days`, `max_failures` |
| Abgesagte oder abgelehnte Treffen | 12 Monate | `events.cancelled_retention_months` |
| Vergangene Treffen | 24 Monate | `events.past_retention_months` |
| Genauer Ort „nach Zusage“ | 30 Tage nach dem Ende | `events.exact_place_retention_days` |
| Kalenderlink für Zugesagte | bis 2 Tage nach dem Ende | `events.calendar_link_days_after` |
| Zwischenspeicher der Ortssuche | 30 Tage | `geocode.cache_days` |
| Fehlerberichte der App | 14 Tage | `logging.channels.client.days` |
| Mitteilungen in der App | 180 Tage | `notifications.retention_days` (galt schon vorher, fehlte im Text) |

## 3. AGB

Die Abschnitte 1 bis 7 behalten ihre Nummern, weil Begründungen von Moderationsentscheidungen Abschnittsnummern zitieren. Neu ab Abschnitt 8.

| Änderung | Grund |
|---|---|
| § 2: Build-Updates, Treffen, Betriebe, Teilekatalog, Wartung; „kein Marktplatz“ | Phase-4-Umfang (ADR-401); keine Verkäufe über die Plattform |
| § 3: Anmeldewege, „Das war ich nicht“, Folgen der Löschung für Treffen | Auth 2.0; `EventHousekeeping::accountClosed` |
| § 4: Lizenz auch für Vorschaubilder von Profilen, Treffen und Betrieben | Neue Vorschaubilder (M4.16) |
| § 8 Build-Updates, Reaktionen, Erwähnungen, Kommentare | ADR-413, 436 |
| § 9 Treffen: Voraussetzungen (bestätigte E-Mail, 14 Tage, Regeln), Vorabprüfung, Organisator verantwortlich, Teilnahme ohne Vertrag mit SPEED CLUB, Warteliste, privater Ort | `events.organiser_min_account_days`, `premoderate_first`, ADR-437 |
| § 10 Betriebe: Unternehmer, ein Profil pro Konto, Prüfung, „Verifiziert“ ist keine Qualitätsaussage, Impressum, Team per Einladung, „Eingebaut von“ mit beidseitiger Zustimmung, keine Bewertungen | ADR-414, 455, 461 |
| § 11 Teilekatalog und Anzeigen (Provision, Vertrag nur mit dem Shop) | UWG-Kennzeichnung „Anzeige“; Flag aus |
| § 12 Wartung und Erinnerungen ohne Gewähr | M4.13 |
| § 13 Mitgliedschaft (noch keine) und Sticker-Shop (externe Bedingungen) | Flags `membership` und `sticker_shop` aus |
| § 14 Moderation: auch Updates, Kommentare, Treffen, Betriebe; Begründung nach Art. 17 DSA auch bei abgelehnten Treffen und Betrieben | ADM-53 bis 56 nutzen die Moderationswarteschlange |
| § 15: Funktionen werden schrittweise eingeschaltet | Feature-Flags |

## 4. Community-Richtlinien

Die Abschnitte 1 bis 7 bleiben unverändert. Neu sind § 8 Treffen (die fünf Regeln, die Organisatoren in EVT-03 bestätigen, wörtlich wie in der App), § 9 Betriebe und Werbung, § 10 Reaktionen, Erwähnungen und Kommentare. In § 11 Melden und § 12 Folgen kommen die neuen Inhaltsarten dazu.

## 5. Impressum

Neuer Abschnitt „Betriebe, Treffen und Anzeigen“: Betriebsprofile haben ein eigenes Impressum in der Verantwortung des Betriebs, Treffen veranstalten die Organisatoren, „Anzeige“-Links können eine Provision bringen.

## 6. Neue Platzhalter für die Prüfung und den Betreiber

| Dokument | Platzhalter | Wer |
|---|---|---|
| Datenschutz § 2 | Rechtsgrundlage für veröffentlichte Impressumsangaben von Einzelunternehmen | Anwalt |
| Datenschutz § 2 | Push im Browser: lit. b oder lit. a | Anwalt |
| Datenschutz § 6 | Ungefähre Stadt aus der IP-Adresse (GeoLite2) ja oder nein | Betreiber (OA-33), Anwalt |
| Datenschutz § 9 | Partnerprogramme und ihre Datenverarbeitung | Betreiber, sobald `affiliate_links` an ist |
| Datenschutz § 13 | Cookie `sc_browser`: § 25 Abs. 2 Nr. 2 TDDDG und Laufzeit von 5 Jahren | Anwalt |
| Datenschutz § 14 | Eigene Verantwortliche oder Auftragsverarbeiter; zuständige Apple- und Google-Gesellschaft; Regionen der Push-Dienste; Sitz von OpenFreeMap; Shop-Betreiber | Anwalt, Betreiber |
| AGB § 9 | Weitere Pflichten des Organisators (Versicherung, Lärm, Verkehrssicherung) und Haftungsverteilung bei Treffen | Anwalt |
| AGB § 10 | Ergänzende Bedingungen für Betriebe (Unternehmer) | Anwalt |
| AGB § 13 | Bedingungen für die Mitgliedschaft und In-App-Käufe; Shop-Betreiber | Betreiber, Anwalt (vor dem Start der Mitgliedschaft) |

Weiterhin offen aus früheren Phasen: Firmendaten (OA-10), § 36 VSBG, Region von Pusher und Cloudflare, Übermittlung in die USA, Server-Protokolle und Sicherungen, Aufbewahrung von Datenschutzanfragen, Fragen aus OA-17.

## 7. Hinweise aus der Prüfung des Codes

1. **Geschlossene Lücke:** Für E-Mail-Codes (`login_attempts`) und Passkey-Vorgänge (`passkey_challenges`) gab es keine Löschroutine. Sie ist jetzt in `speedclub:prune-platform` ergänzt (24 h, Test `SignInDataPruneTest`). 09 §13 nannte 30 Tage; die Konfiguration sah schon 24 h vor. Der Text nennt die kürzere Frist, die der Code jetzt einhält.
2. **Begründungsvorlagen (erledigt):** Die mitgelieferten Vorlagen nannten Abschnittsnummern, die schon vor Phase 4 nicht zu den Überschriften passten: AGB „6“ für Identitätsmissbrauch (richtig: § 3 Konto), Community „3“ für Nacktheit (richtig: § 4) und „4“ für Spam (richtig: § 6). Die Migration `2026_12_10_100000` korrigiert jede Vorlage, die noch so ist, wie sie ausgeliefert wurde; von Hand geänderte Vorlagen bleiben unberührt (Test `M418DataFixesTest`).
3. **Profilaufrufe von Betrieben (erledigt):** `speedclub:prune-platform` löscht Tageszahlen (`business_view_days`) nach `views_retention_days` (400 Tage), nie vor dem 30-Tage-Fenster des Dashboards. Es sind Tageszahlen ohne Personenbezug; Aufrufe bekannter Bots und Vorabrufe zählen nicht.
4. **Apple (erledigt):** Der Widerruf bei Apple läuft jetzt überall, wo eine Apple-Verknüpfung wegfällt: beim Löschen des Kontos, beim Trennen der Verknüpfung, bei „Das war ich nicht“ und beim Bereinigen eines nicht bestätigten Kontos, jeweils nach der Antwort und protokolliert (Test `AppleRevokeTest`).
5. **App Store und Play (erledigt):** Die Angaben zum Datenschutz („Nutrition Label“ bzw. Datensicherheit) sind um Anmeldung mit Apple und Google, Passkeys, Treffen (Region), Betriebe, Push im Browser, Geräte-Kennung und Fehlerberichte ergänzt (`docs/STORE_READINESS.md` §5 und §6). Neu gegenüber Phase 3: Fehlerberichte (Diagnose), grober Standort (gewählte Region), Anschrift und Telefon von Betrieben, Geräte-ID.
