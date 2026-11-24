# Rechtstexte: Änderungen für SPEED CLUB 2.1 (Phase 5, Geschenk-Funktionen)

Entwurf – rechtliche Prüfung ausstehend (OA-35). Keine Rechtsberatung: Das Team hat die Texte so geschrieben, dass sie beschreiben, was die Software tatsächlich tut. Ob sie rechtlich genügen, entscheidet die anwaltliche Prüfung.

- **Quellen:** `web/database/data/legal/{privacy,terms,community}.{de,en}.md` (Seeder `LegalDocumentSeeder`, Verwaltung in ADM-31 „Rechtstexte“). Verbindlich ist die deutsche Fassung. Impressum und Lizenzen sind unverändert (GeoNames steht seit M5.9b in `licenses.*.md`, Migration `2026_12_16_120000_publish_licences_with_geonames`).
- **Platzhalter:** `[[…]]`. Firmendaten füllt der Betreiber in den Organisationseinstellungen (ADM-52). Alle anderen `[[…]]` sind offene Entscheidungen für die Prüfung oder den Betreiber (Abschnitt 6).
- **Umfang:** nur die Geschenk-Funktionen aus 10 §16 (M5.9a–e). Shop, Forum, Insights und die Umbenennung „QR-Code“ → „Sticker“ (ADR-504) kommen mit ihren Modulen.
- **Stand:** 2026-11-15, Modul M5.9f.

## 1. Wie die neue Fassung ausgeliefert wird

- **Neue Installation:** Der Seeder legt die neuen Texte als Version 1 an.
- **Bestehende Installation** (lokal, Staging): Die Migration `2026_12_21_100000_publish_phase_5_legal_drafts` veröffentlicht die neue Fassung von Datenschutzerklärung, AGB und Community-Richtlinien als nächste Version (Begründung „Phase-5-Entwürfe (M5.9f, OA-35) … keine erneute Zustimmung“, Audit `legal.published`). Das passiert nur, wenn der veröffentlichte Text noch ein unveränderter Seeder-Entwurf ist; die Liste enthält jeden früheren Entwurf, auch die Phase-4-Fassung, die `2026_12_09_100000` veröffentlicht hat. Texte, die Mitarbeitende in ADM-31 geändert haben, bleiben, wie sie sind. Ein zweiter Lauf ändert nichts.
- **Keine erneute Zustimmung:** wie in Phase 4. Erneute Zustimmung löst ADM-31 beim Veröffentlichen der geprüften Fassung aus (Vier-Augen-Prinzip, ADR-236 f, ADR-245). Die Produktion hat noch keine Mitglieder (OA-10).
  **Zu entscheiden:** ob die geprüfte Fassung vor dem Start mit „erfordert erneute Zustimmung“ veröffentlicht wird.
- **Abschnittsnummern:** Begründungen von Moderationsentscheidungen zitieren AGB 1–7 und Community 1–7; diese bleiben. Neue Abschnitte stehen hinter den Phase-4-Abschnitten, die folgenden sind neu nummeriert (Datenschutz ab 13, AGB ab 14, Community ab 11). Andere Stellen im Code zitieren keine dieser Nummern.

## 2. Datenschutzerklärung

Gliederung neu: 1 Verantwortlicher · 2 Daten (Tabelle) · 3 Öffentlich sichtbar · 4 Fotos, Kennzeichen und Gesichter · 5 QR-Codes · 6 Anmeldung und Kontosicherheit · 7 Treffen · 8 Karten und Ortssuche · 9 Betriebe, Teilekatalog und Anzeigen · 10 Web-App und Push im Browser · 11 Vorschaubilder · 12 Fehlerberichte · **13 STREET DEX: Kamera, Standort und Spots** · **14 Level, Abzeichen, Founding Member und Car of the Day** · **15 Einladungen** · **16 Build Score** · **17 Season Wrapped** · **18 Mitteilungen zu Spots, Abzeichen, Car of the Day und Einladungen** · 19 Cookies und Speicher (vorher 13) · 20 Empfänger (vorher 14) · 21 KI (vorher 15) · 22 Speicherdauer (vorher 16) · 23 Rechte (vorher 17) · 24 Altersgrenze (vorher 18) · 25 Änderungen (vorher 19).

| Änderung | Grund (was gebaut wurde, Stelle im Code) |
|---|---|
| Tabelle § 2: Profil mit dem daraus abgeleiteten Bundesland | `users.bundesland` kommt nur aus der öffentlichen Profil-Stadt (`CityMatcher::bundeslandFor`, CR-P5G-08, Migration `2026_12_20_100000`); es steht auf Rangzeilen und steuert die Car-of-the-Day-Rotation |
| Tabelle § 2: Garage „Fotos mit deiner Entscheidung zum Kennzeichen“; Einstellungen „Meine Spots zeigen“ und ausgeblendeter Hinweis „Kennzeichen prüfen“ | `media.plate_blur` (blurred, declined, unchecked), `users.show_my_spots`, `users.plate_check_dismissed_at` (M5.9a, M5.9b) |
| Tabelle § 2: neue Zeilen STREET DEX (Spots; Fortschritt und Autos), Level und Abzeichen, Founding Member, Einladungen, Car of the Day, Build Score, Season Wrapped | Tabellen `spots`, `user_set_progress`, `vehicle_spot_stats`, `vehicles.{dex_number, rarity, ghost_mode, spotting_paused, hide_spot_cities}`, `xp_events`, `users.{xp, founding_number, activated_at, pending_invite_code}`, `user_badges`, `invite_codes`, `car_of_the_day`, `build_scores`, `build_score_history`, `build_score_ranks`, `wrapped` |
| Tabelle § 2: „Geräte, Sitzungen und Kontosicherheit“ um die zweite Prüfsumme ohne Kontobezug und den Zweck „Missbrauchsabwehr beim Spotten“ ergänzt; berechtigtes Interesse „faire Spots“ | ADR-511: `device_installs.install_key` = HMAC der Installationskennung mit dem App-Schlüssel, ohne Mitglied (`DeviceInstalls::installKey`); einziger Leser `App\Services\Admin\Spots\SharedDevices`; auf dem Model versteckt (`DeviceInstall::$hidden`) |
| § 3 Öffentlich: Level mit Titel (nicht die XP), Abzeichen, Founding-Member-Nummer; Dex-Nummer, Seltenheit, Build Score mit Stufe, Teilpunkten und Rängen; Story-Zeile des Car of the Day; Spotzahlen nur für den Besitzer, Zahl der Städte auf der Dex-Karte für Mitglieder; Ghost-Modus | `MemberPublicResource` (`level`, `founding_number`), `GET users/{username}/badges` (Gäste), `PublicVehicleResource.dex_number`, `BuildScoreResource` (Gäste), `SpotCard.cities_count_label` (nur Mitglieder, Tagesspots, aus bei „Städte verbergen“), `GhostMode` (`/v/{slug}` noindex) |
| § 4 Kennzeichen unkenntlich machen | ADR-509, M5.9a: Schalter vorbelegt an; GD verpixelt vor dem ersten Speichern (`ImageProcessor::process`), Master und private Originaldatei sind schon verpixelt, alle Varianten, OG-Bilder, Share-Karten und Wrapped-Karten daraus; „aus“ speichert `declined`; späteres Verpixeln per `PATCH media/{id}` für Fahrzeug-, Mod-, Update- und Profilfotos (nicht Treffen/Betriebe), ersetzt die Originaldatei (`keepOnlyCurrentFiles`), rückgängig nur per Neu-Upload; einmalige Abfrage „Kennzeichen prüfen“ (`GET me/plate-check`); keine automatische Erkennung, nur ein vorgeschlagenes Rechteck |
| § 11: QR auf servergezeichneten Bildern = öffentliche Seite | ADR-514, `QrCodes::pageUrl` (`/v/{slug}`), Test `ServerDrawnQrTest` |
| § 13 Kamera | `expo-camera` nur für Barcodes, Mikrofon aus (`mobile/app.config.ts`: `microphonePermission: false`, `recordAudioAndroid: false`); kein Speichern; Web ohne Scanner (`Permissions-Policy camera=()`) |
| § 13 Standort | ADR-508: nur im Vordergrund, nur beim Scannen, optional (`mobile/src/features/dex/location.ts`); Android `ACCESS_FINE_LOCATION` und Hintergrundstandort im Release gesperrt (`RELEASE_BLOCKED_PERMISSIONS`), iOS `NSLocationDefaultAccuracyReduced`; nächste Stadt auf dem Gerät aus `/geo/de-cities.json` (GeoNames); gesendet werden `city_id` und Bundesland; `POST spots` lehnt `lat`, `lng`, `location` usw. mit 422 ab; `spots` hat keine Koordinatenspalte (`SpotPrivacySchemaTest`) |
| § 13 Was wir speichern | `RecordSpot`: 24-h-Duplikat (`dex.duplicate_hours`), junge Konten zählen nicht (`dex.young_account_hours`), Beispiel-Autos zählen nicht (CR-P5G-07, `meta.reason = sample_car`), Nacht 22–6 (`dex.night`), erste drei Spotter (`dex.first_spotters`) |
| § 13 Was der Besitzer sieht | DEX-06 `GET vehicles/{id}/spot-stats` (nur Besitzer): Summen, Städte nur aus Tagesspots, 30 Tage (`dex.stats_days`), bis zu 10 letzte Spotter (`dex.recent_spotters`); Namen und Tage erst nach 3 h (`dex.alerts.window_hours`, CR-P5G-01, `OwnerSpotStats::cutoff`); Name nur bei `show_my_spots`, öffentlich sichtbarem Profil und ohne Blockierung, sonst `anonymous`; Sammel-Mitteilung `dex:spot-alerts` alle 3 h, eine Zeile pro Auto und Tag, ohne Spotter |
| § 13 Einstellungen des Autos, Spotkarte | Ghost-Modus, „Spotten pausieren“, „Städte verbergen“ (M5.9b); `GET spot-map`: Spots 24 h bis 90 Tage alt, Stadt erst ab 5 verschiedenen Autos (`dex.map.*`, SEC-P5G-03), ohne Ghost-Autos und verborgene Städte, keine Fahrzeuge oder Personen |
| § 13 Missbrauchsabwehr | `SpotSignals`: mehr als 10 Spots in 10 min, über 300 km in 1 h, gleiche Installation (`SharedDevices`); beim Lesen berechnet, nicht gespeichert; ADM-62 nur `moderation.view`; „Spot entfernen“ nimmt Set-Abschlüsse und XP zurück (SEC-P5G-05); keine automatische Sperre |
| § 14 XP und Level | `config/speedclub.php` `xp`: feste Punkte je Art, `daily_cap` 200, Build-Update höchstens einmal am Tag (`build_update.daily_max` 15); keine Hooks für Reaktionen, Follows, Kommentare oder Anmelden (ADR-513, `XpTest`); Level 1–10 (`xp.levels`) |
| § 14 Abzeichen | `BadgeMetrics` (feste Metriken, nichts aus Likes, Reaktionen, Followern, Beiträgen, Anmeldungen); versteckte Abzeichen; Entzug durch das Team (`RevokeBadge`, `moderation.decide`) |
| § 14 Founding Member | `MemberActivation`, `FoundingNumbers`: bei Aktivierung (bestätigte Adresse und aktuelle Bedingungen), nur Produktion (`founding.environments`), höchstens 1.000 (`founding.max`), nie neu vergeben, Test- und Beispielkonten ausgeschlossen (`founding.excluded_email_domains`); Nachvergabe für schon Aktive in Aktivierungsreihenfolge (`speedclub:founding:backfill`, CR-P5G-09) |
| § 14 Car of the Day | `CarOfTheDayPicker`, `CarOfTheDays`: 18:00 bis 18:00 (`car_of_the_day.publish_at`), Build Score ≥ 400, ≥ 4 Fotos, 180 Tage Abstand, Bundesland reihum, höchster Score, nie Zufall; Team kann ersetzen oder auslassen (ADM-64); Story-Zeile = erster Satz der Beschreibung, Besitzer kann sie ändern (`UpdateCarOfTheDayStory`, 140 Zeichen); Besitzer wird benachrichtigt, andere nur nach Opt-in; ein Ghost-, nicht gelistetes oder privates Auto wird nicht gewählt, bei Veröffentlichung zurückgezogen (SEC-P5G-02) und auf Home bei jedem Lesen ausgeblendet (`shownTo`) |
| § 15 Einladungen | `InviteCodes`, `MemberActivation`: 5 Codes (`invites.per_member`); `GET invites/{code}` und `/join/{code}` zeigen Benutzer- und Anzeigenamen des Einladenden; Code bis zur Aktivierung in `users.pending_invite_code`; INV-01 zeigt den Eingeladenen nur, wenn öffentlich sichtbar und ohne Blockierung; Mitteilung `invite_accepted` ohne Namen; nur „Crew Starter“, keine XP |
| § 16 Build Score | ADR-512, `config/speedclub.php` `build_score`: vier Bereiche, Werte nie gelesen (`BuildScoreInputs`); öffentlich Score, Stufe, Ränge; Teilpunkte und letzte Änderung (`parts`, `previous_total`) nur für den Besitzer (Gift-Gate); Ränge ab 3 Autos (`build_score.ranks.min_group`), nie Ghost-, nicht gelistete, private oder Beispiel-Autos; Bundesland nur aus der öffentlichen Stadt; `build_score_history` je Tag; „Nächstes Upgrade“ nur für den Besitzer, ohne Community-Punkte |
| § 17 Season Wrapped | ADR-513, M5.9e, `app/Services/Wrapped/Cards/*`: Saison 1.3.–31.10. und Jahr; Erstellung ab 7 Tagen vor der Freigabe (`wrapped.generate_days_before`), Termine vom Team (ADM-37); nur eigene Daten; Städte nur aus Tagesspots, höchstens 5, ohne verborgene Städte und Ghost-Autos, keine Besitzer; Treffen-Titel nur öffentlich; Prozentwert ab 20 Mitgliedern und nur in den besten 50 % (`wrapped.percentile.*`); Fotos nur von eigenen Autos (Galerie und eingebaute Mods des Autos der Karte, Vorher-Nachher; ADR-516 a: Intro, Build Score, Build Spirit, Teilen), nie von anderen Mitgliedern, ihren Autos oder Treffen, und nur mit Kennzeichen-Entscheidung; Kartenbilder privat; QR = `/v/{slug}` (ADR-514); `viewed_at`, `shared_count`; Flag `wrapped` in Produktion aus |
| § 18 Mitteilungen | `NotificationPrefs::TYPES` (Push aus für `badge_unlocked` und `car_of_the_day`, an für `spot_alert`, `car_of_the_day_owner`, `invite_accepted`, je ein Schalter in SET-09); `SocialPushLimiter`: ein Push pro Tag über `spot_alert`, `badge_unlocked`, `car_of_the_day`, `invite_accepted`, nie 22–8 (`notifications.social_quiet_hours`); `car_of_the_day_owner` außerhalb dieser Grenze, eigene Ruhezeiten gelten (`Notifier::maybePush`) |
| § 19 Speicher auf dem Gerät: Ortsliste und Entscheidung zum Standort | `mobile/src/features/dex/cities.ts` (Datei im App-Speicher, ETag höchstens wöchentlich), `sc.dexLocation` |
| § 20 Empfänger: keine neuen Stellen | GeoNames-Liste liegt auf unserem Server; Standortdienste des Betriebssystems im Text bei § 13 genannt |
| § 22 Speicherdauer: neue Zeilen (Tabelle unten) | der Pest-Test `Phase5LegalDraftsTest` vergleicht jede Zahl mit der Konfiguration oder der Konstante im Code |
| § 23 Rechte: Export um die Geschenk-Daten ergänzt; Löschen entfernt Spots und Set-Fortschritt sofort; neue Einstellungen | `ExportContents`: `spots.json`, `spots_of_my_cars.json`, `progress.json`, `invites.json`, `car_of_the_day.json`, `wrapped.json`, Build Score mit Verlauf in den Fahrzeugen; andere Mitglieder nur wie DEX-06/INV-01, sonst „ein Mitglied“ (`settings.export.a_member`); nie Koordinaten oder `install_key`. `DeleteAccount` → `SpotPurger::forMember` |

### Speicherdauer laut Code

| Daten | Frist | Stelle im Code |
|---|---|---|
| Spots | sofort, wenn der Spotter oder der Besitzer das Konto löscht; mit einem gelöschten Auto nach 30 Tagen | `SpotPurger::forMember` (in `DeleteAccount`), FK `spots.vehicle_id` cascade, `vehicles:prune` mit `garage.hard_delete_after_days` |
| Spots, die das Team entfernt hat | wie andere Spots (weich gelöscht, zählen nicht) | `RemoveSpots` (Soft Delete); **keine eigene Frist** → Platzhalter |
| Zusammenfassungen der Spot-Mitteilung (`spot_alerts`) | mit dem Auto | FK cascade; **keine eigene Frist** → Platzhalter |
| Set-Fortschritt (`user_set_progress`) | sofort beim Löschen des Kontos | `SpotPurger::forMember` |
| XP-Einträge, Level, Abzeichen | bis zur endgültigen Löschung des Kontos | FK `users` cascade, `account_deletion.hard_delete_after_days` (30); Abzeichen-Entzug `RevokeBadge` |
| Founding-Member-Nummer | bis zur endgültigen Löschung; nie neu vergeben | `users.founding_number`, `sequence_counters.founding_number` |
| Einladungscodes | bis zur endgültigen Löschung; genutzte Codes bleiben genutzt (`accepted_at`), Verknüpfung null | FK `invite_codes.inviter_id` cascade, `accepted_by` null on delete (CR-P5G-10) |
| Code bei der Registrierung | bis zur Aktivierung; unbestätigtes Konto nach 7 Tagen | `users.pending_invite_code`, `ClearUnprovenAccountData`, `verification.unverified_account_retention_days` |
| Car-of-the-Day-Tage | bis das Auto endgültig gelöscht ist | FK `car_of_the_day.vehicle_id` cascade |
| Build Score und Stand je Tag | bis das Auto endgültig gelöscht ist | FK cascade; **keine Frist für `build_score_history`** → Platzhalter |
| Ränge | jede Nacht neu, alte Ränge in der folgenden Nacht gelöscht | `build-score:nightly`, Schritt `prune` (`BuildScoreNightly`) |
| Season Wrapped | bis zur endgültigen Löschung; ohne Aktivität beim nächsten Erstellen gelöscht | FK cascade, `WrappedGenerator::generate`; **keine Frist** → Platzhalter |
| Kartenbilder von Season Wrapped | bis sich der Inhalt ändert; ohne Wrapped täglich | `WrappedCardImages`, `speedclub:wrapped:prune-cards` (täglich 04:50) |
| Tagesgrenze für Gift-Push (`social_push_claims`) | 7 Tage | `SocialPushLimiter::KEEP_DAYS`, `notifications:prune` (täglich) |
| Mitteilungen in der App (auch die neuen Arten) | 180 Tage | `notifications.retention_days` (unverändert) |
| Zweite Prüfsumme der App-Installation (`install_key`) | mit der App-Installation: 12 Monate nach der letzten Nutzung, beim Löschen des Kontos sofort | `known_devices.retention_months` (unveränderte Zeile „App-Installationen“) |
| Ortsliste `de_cities` | keine Personendaten | `DeCitySeeder` |

Weitere Zahlen im Text, ebenfalls im Test geprüft: `dex.duplicate_hours` 24, `dex.young_account_hours` 24, `dex.stats_days` 30, `dex.recent_spotters` 10, `dex.alerts.window_hours` 3, `dex.map.{min_age_hours 24, days 90, min_cars 5}`, `SpotSignals::{BURST_MORE_THAN 10, BURST_SECONDS 600, HOP_KM 300, HOP_SECONDS 3600}`, `xp.daily_cap` 200, `xp.levels` 1–10, `founding.max` 1000, `car_of_the_day.{publish_at 18:00, min_build_score 400, min_photos 4, gap_days 180, story_max 140}`, `invites.per_member` 5, `build_score.{max 1000, ranks.min_group 3}`, `wrapped.{season_start 03-01, season_end 10-31, generate_days_before 7, max_cities 5, percentile.min_members 20, percentile.max_top 50}`, `dex.night` 22–6, `notifications.social_quiet_hours` 22–8.

## 3. AGB

Die Abschnitte 1 bis 13 behalten ihre Nummern. Neu sind § 14 und § 15; Moderation, Verfügbarkeit, Haftung, Kündigung und Schlussbestimmungen sind jetzt § 16 bis § 20.

| Änderung | Grund |
|---|---|
| § 2: STREET DEX, Level und Abzeichen, Build Score, Season Wrapped | Umfang von 10 §16 |
| § 14 STREET DEX und Spots: Regeln, wann ein Spot zählt; Besitzer-Schalter; Seltenheit und Dex-Nummer sind keine Aussage über Wert, Zustand oder Zulässigkeit; Missbrauch | `RecordSpot`, `RarityRules`, `DexNumbers`, `RemoveSpots` |
| § 15: kein Geldwert, nicht übertragbar, kein Anspruch; Regeln für die Zukunft änderbar; Rücknahme bei Missbrauch; Build Score keine Aussage über Zulässigkeit; Car of the Day als Anzeige nach § 4, kein Anspruch, Ausweg Ghost/Nicht gelistet/Privat; Founding Member; Einladungen; Season Wrapped teilen | ADR-512, ADR-513, `formula_version` |
| § 16 Moderation: Spots entfernen, XP, Sets und Abzeichen zurücknehmen | `RemoveSpots`, `RevokeBadge` |

## 4. Community-Richtlinien

Die Abschnitte 1 bis 10 bleiben. § 5 Privatsphäre nennt den vorbelegten Schalter „Kennzeichen unkenntlich machen“. Neu sind § 11 STREET DEX und Spots (nur vor Ort scannen, das Auto in Ruhe lassen, keinem Auto hinterherfahren, niemanden verfolgen oder dem Besitzer auflauern, keine Standorte veröffentlichen, keine Fotos von Menschen gegen ihren Willen, ein Konto pro Person, Ghost-Modus respektieren) und § 12 Level, Abzeichen, Build Score und Einladungen (nicht austricksen, Einladungen nicht als Massenwerbung). Melden und Folgen sind jetzt § 13 und § 14; Folgen nennt das Entfernen von Spots und das Zurücknehmen von XP, Sets und Abzeichen.

## 5. Impressum und Lizenzen

Unverändert. Die Namensnennung für GeoNames (CC BY 4.0) steht seit M5.9b in den Lizenzen.

## 6. Neue Platzhalter für die Prüfung und den Betreiber

| Dokument | Platzhalter | Wer |
|---|---|---|
| Datenschutz § 2 | Car of the Day: lit. b oder lit. f, da das Auto ohne eigene Bewerbung ausgewählt wird | Anwalt |
| Datenschutz § 13 | „Meine Spots zeigen“ ist an voreingestellt; nach Art. 25 Abs. 2 DSGVO ausgeschaltet nötig? | Anwalt, Betreiber |
| Datenschutz § 22 | Frist für Spots, die das Team entfernt hat (bisher bis zur Löschung von Konto oder Auto) | Betreiber, Anwalt |
| Datenschutz § 22 | Frist für die Zusammenfassungen der Spot-Mitteilungen (`spot_alerts`) | Betreiber |
| Datenschutz § 22 | Frist für den Build Score je Tag (`build_score_history`) | Betreiber |
| Datenschutz § 22 | Frist für Season Wrapped (`wrapped`) | Betreiber |

Weiterhin offen aus Phase 4 und früher: siehe `phase-4-changes.md` Abschnitt 6.

## 7. Hinweise aus der Prüfung des Codes

1. **Keine eigene Löschfrist** für weich gelöschte Spots, `spot_alerts`, `build_score_history` und `wrapped`: Sie gehen nur mit Konto oder Auto. Der Text sagt das und setzt Platzhalter; neue Löschroutinen sind nicht Teil dieses Moduls.
2. **Community-Punkte (behoben am Gift-Gate).** `GET vehicles/{id}/build-score` zeigte Gästen die Punkte je Bereich; der Bereich Community besteht aus 2 Punkten je reagierendem Mitglied (bis 100), 1 je Spotter (bis 100) und 1 je Follower (bis 50), daraus ließ sich die private Zahl der Reaktionen ungefähr ableiten. Seit dem Gift-Gate bekommt nur der Besitzer die Punkte je Bereich und die letzte Änderung („+25“, `previous_total`: einzelne Schritte von +2 hätten neue Reaktionen verraten); Gäste und andere Mitglieder sehen Gesamtwert, Stufe und Ränge (die App hat die Teilwerte nie angezeigt). Bleibt für den Betreiber: Der Gesamtwert enthält den Community-Bereich weiter (Formel des Betreibers, 10 §16.3); wer die übrigen Bereiche aus öffentlichen Angaben nachrechnet, kann ihn grob schätzen. Der Text sagt, dass der Build Score nicht zeigt, wer reagiert hat.
3. **„Meine Spots zeigen“ ist voreingestellt an** (`users.show_my_spots` default true, `2026_12_16_100000`). Die Arbeitsliste nannte keine Voreinstellung; der Text sagt es offen.
4. **Car of the Day ohne eigenen Abmeldeschalter.** Der Besitzer kann die Auswahl nur über Ghost-Modus, „Nicht gelistet“ oder „Privat“ vermeiden; ein gewähltes Auto verschwindet dann sofort von der Startseite. Die Arbeitsliste sprach von „zurückziehen“; einen eigenen Schalter gibt es nicht.
5. **Eingeladene sehen den Einladenden** beim Registrieren über `GET invites/{code}` und `/join/{code}` mit Benutzer- und Anzeigenamen; diese Abfrage prüft nicht die Regel „öffentlich sichtbar und keine Blockierung“, sondern weist nur gelöschte, gesperrte, unbestätigte, namenlose und Beispiel-Einladende ab. Die Regel gilt für INV-01 und den Datenexport. Der Text beschreibt beides so.
6. **Push „Dein Auto ist Car of the Day“ (behoben am Gift-Gate).** Er zählt weiter nicht zur Tagesgrenze (ADR-513), hält aber jetzt auch die feste Ruhezeit 22–8 ein (`SocialPushLimiter::QUIET_ONLY`); vorher konnte ein Ersatzauto, das das Team spät am Abend wählt, nach 22 Uhr pushen. In der Liste der Mitteilungen steht er immer.
7. **Founding-Member-Nummern** gibt es nur in der Produktion; auf Staging sieht man sie nur in Demo-Daten.
8. **Abzeichen-Entzug:** Die Gift-Fix-Runde nannte „Badge entziehen“ offen; `RevokeBadge` (ADM-10, `moderation.decide`, Audit `badge.revoked`) ist inzwischen gebaut. Der Text nennt ihn.
9. **ADM-31-Demoentwurf auf Staging:** `BrandContentDemoSeeder::privacyDraft()` legt einen unveröffentlichten Datenschutz-Entwurf aus der damaligen Datei an. Auf einem Host, der nach M4.18 geseedet wurde, enthält dieser Entwurf noch den Phase-4-Text. Wird er in ADM-31 veröffentlicht, ersetzt er den Phase-5-Text. Nur lokal und auf Staging (die Produktion hat keinen Demoentwurf); eine Datenmigration wie `2026_12_10_100100_refresh_demo_privacy_draft` würde ihn auf die neue Datei heben.

## 8. Nachtrag M5.7: Aufrufe, Statistiken, Build-Erinnerungen und Wochenrückblick

Stand: 2026-11-16, Modul M5.7 (`docs/reports/phase-5/m5.7-contract.md` §13). **Jetzt in den Dateien (BL-21, Review SF-7):** `web/database/data/legal/privacy.{de,en}.md` enthalten §8.1 als neuen Abschnitt **18 „Aufrufe und Statistiken“**, dazu neu **19 „Forum“** (§10 unten); die folgenden Abschnitte sind um zwei weitergerückt (Mitteilungen 20, Cookies 21, Empfänger 22, KI 23, Speicherdauer 24, Rechte 25, Altersgrenze 26, Änderungen 27). §8.2 steht am Ende von Abschnitt 20, §8.3 in der Tabelle von Abschnitt 2, in Abschnitt 3 und 25, §8.4 in Abschnitt 24. Gegenüber dem Entwurf unten geändert, weil der Code nach dem Review anders arbeitet: keine Uhrzeit mehr bei einzelnen Aufrufen (SF-2), höchstens 3 neue Aufrufe pro Adresse, Seite und Tag (SF-1), der Tagesschlüssel geht kurz nach Mitternacht. Ausgeliefert über **eine** Migration für alle Phase-5-Änderungen der Datenschutzerklärung: `2026_12_29_100300_publish_phase_5_privacy_update` (wie `2026_12_21_100000`: nur über einen unveränderten Seeder-Entwurf, `SEEDED` enthält die beiden M5.9f-Fassungen aaa2adf9 und fe175279; keine erneute Zustimmung; Audit `legal.published`; ein zweiter Lauf ändert nichts). Tests: `Phase5LegalDraftsTest` (Inhalt, Zahlen gegen die Konfiguration, Nummern), `Phase5PrivacyUpdateTest` (Veröffentlichung).

### 8.1 Neuer Abschnitt „Aufrufe und Statistiken“ (nach „Season Wrapped“, die folgenden Abschnitte rücken eins weiter)

> **Aufrufe und Statistiken**
>
> Wir zählen, wie oft öffentliche Fahrzeugseiten und Profile angesehen werden, damit Besitzerinnen und Besitzer sehen, wie ihr Build ankommt. Gezählt wird ein Aufruf pro Person, Seite und Kalendertag (deutsche Zeit), dazu die Quelle: App, Web, Sticker-Scan oder geteilter Link. Ein geteilter Link ist an der Endung `?via=share` erkennbar, die die App beim Teilen anhängt.
>
> Damit wir eine Person an einem Tag nicht doppelt zählen, bilden wir aus deiner Mitgliedsnummer – oder, wenn du nicht angemeldet bist, aus deiner IP-Adresse (bei IPv6 gekürzt auf die ersten 64 Bit) und der Kennung deines Browsers bzw. deiner App – eine Prüfsumme mit einem geheimen Schlüssel, der nur für diesen Tag gilt. Gespeichert wird nur diese Prüfsumme, nicht die IP-Adresse, die Browserkennung oder deine Mitgliedsnummer. Den Tagesschlüssel löschen wir, sobald der Tag vorbei ist; danach kann niemand – auch wir nicht – eine gespeicherte Prüfsumme einer Person zuordnen. Die einzelnen Einträge löschen wir nach 90 Tagen; es bleiben nur die Tagessummen.
>
> Nicht gezählt werden: Aufrufe der eigenen Seiten, Aufrufe durch unser Team in der Supportansicht, bekannte Bots, Vorschaudienste und Vorab-Ladevorgänge des Browsers, Beispielinhalte sowie Seiten, die du nicht sehen darfst (zum Beispiel nach einer Blockierung).
>
> Besitzerinnen und Besitzer sehen in „Statistiken“ nur Summen: Aufrufe pro Tag und Woche, die Quellen, Sticker-Scans, Spots, neue Follower, wie oft der Build gemerkt wurde und die Reaktionen. **Wer eine Seite angesehen hat, zeigen wir niemandem** – weder den Besitzern noch anderen Mitgliedern noch unserem Team, auch nicht in der Supportansicht. Aufrufzahlen sind nie öffentlich. Ab 100 Aufrufen kann auf dem Profil das Abzeichen „100 Aufrufe“ erscheinen; es nennt keine Zahl.
>
> Auf deinem Gerät speichern wir dafür nichts (keine Cookies, kein lokaler Speicher). Rechtsgrundlage ist unser berechtigtes Interesse und das der Besitzer an einer datensparsamen Reichweitenstatistik (Art. 6 Abs. 1 lit. f DSGVO). [[Prüfung: § 25 TDDDG nicht berührt, da kein Zugriff auf das Endgerät über die übliche Seitenanfrage hinaus – bitte bestätigen]] Eine Zählung schaltet das Team bei Bedarf ganz ab; dann wird gar nichts gespeichert.

### 8.2 Ergänzung „Mitteilungen“ (bisher „Mitteilungen zu Spots, Abzeichen, Car of the Day und Einladungen“)

> *Build-Erinnerungen:* Wenn der Zielmonat einer geplanten Mod da ist, fragen wir dich höchstens einmal pro Woche, ob sie schon verbaut ist („Ist das KW V3 schon verbaut? Trag es ein.“). *Wochenrückblick:* Sonntags ab 18 Uhr bekommst du eine kurze Zusammenfassung deiner Woche – Aufrufe, Sticker-Scans, neue Follower, Spots, anstehende Fälligkeiten und Treffen in der Nähe deiner selbst gewählten Heimatregion (nie dein Standort) – per Push, oder per E-Mail, wenn kein Push bei dir ankommt. Ist in deiner Woche nichts passiert, schicken wir nichts. Beides ist voreingestellt an; du schaltest es in den Einstellungen unter „Mitteilungen“ aus, den Wochenrückblick per E-Mail auch über den Abmeldelink in jeder dieser E-Mails (ein Klick). Solche Hinweise (Build-Erinnerungen, Wochenrückblick, Abzeichen, Spots, Car of the Day, Sticker-Meilensteine, gemerkte Builds, neue Treffen in deiner Nähe) kommen höchstens dreimal pro Woche als Push und nie zwischen 22 und 8 Uhr; alles Weitere steht nur in der Mitteilungsliste der App. Über deine Aufrufe schicken wir nie eine Mitteilung. Rechtsgrundlage: Art. 6 Abs. 1 lit. b DSGVO (Nutzungsvertrag). [[Prüfung: Einordnung des Wochenrückblicks per E-Mail – Servicemitteilung oder Werbung (§ 7 UWG), weil er auch Treffen nennt]]

### 8.3 Tabelle § 2, Rechte und Ziel des Builds

| Änderung | Grund (was gebaut wurde, Stelle im Code) |
|---|---|
| Tabelle § 2: neue Zeile „Aufrufe“ (Tagesschlüssel, Prüfsumme je Aufruf, Tagessummen) | `view_salts`, `view_events` (keine Spalte für IP, Browserkennung, Mitglied oder Gerät; `ViewCountingTest` „stores no address …“), `view_days`; `App\Services\Insights\ViewRecorder`, `ViewSalts` |
| Tabelle § 2 Garage: Ziel „Saison 2027“ | `vehicles.build_goal_season` (öffentlich mit der Fahrzeugseite, `build_goal`), M5.7 |
| Tabelle § 2: Wochenrückblick-Protokoll, Zähler der Engagement-Pushes | `weekly_recaps`, `engagement_push_claims` (Mitteilungsteil von M5.7) |
| § 3 Öffentlich: Ziel „Saison 2027“, Abzeichen „100 Aufrufe“ und „Hilfreich“ | `PublicVehicleResource.build_goal`, `BadgeSeeder` (`100-aufrufe`, `hilfreich-10`) |
| Rechte: Export um `insights.json` ergänzt | `ExportContents::insights`: Tagessummen je Profil/Auto und Quelle, nie Einzelaufrufe oder Prüfsummen; `build_goal_season` in `vehicles.json` |

### 8.4 Speicherdauer

| Daten | Frist | Stelle im Code |
|---|---|---|
| Tagesschlüssel für Aufrufe (`view_salts`) | bis zum Ende des Tages | `ViewSalts::forDay` (löscht beim ersten Aufruf eines neuen Tages), `views:prune` täglich 04:15 |
| einzelne Aufrufe mit Prüfsumme (`view_events`) | 90 Tage (`insights.raw_retention_days`), ab dem Folgetag ohne Personenbezug | `views:prune` (`ViewRetention`) |
| Aufrufe pro Tag und Quelle (`view_days`) | mit dem Fahrzeug bzw. dem Konto | FK cascade |
| Wochenrückblick-Protokoll (`weekly_recaps`) | 12 Wochen | `ViewRetention::RECAP_WEEKS` |
| Zähler für Engagement-Pushes (`engagement_push_claims`) | 14 Tage | `ViewRetention::CLAIM_DAYS` |
| Ziel des Builds, Stand der Build-Erinnerung (`modifications.plan_prompted_for`) | mit dem Fahrzeug bzw. der Mod | FK cascade |
ADM-47 zeigt „Einzelne Aufrufe (Statistiken)“ mit 90 Tagen (`RetentionPolicy::FIXED['view_events']`).

### 8.5 Neue Platzhalter

| Dokument | Platzhalter | Wer |
|---|---|---|
| Datenschutz „Aufrufe und Statistiken“ | § 25 TDDDG (kein Endgerätezugriff) bestätigen | Anwalt |
| Datenschutz „Mitteilungen“ | Wochenrückblick per E-Mail: Servicemitteilung oder Werbung (§ 7 UWG), Voreinstellung „an“ | Anwalt, Betreiber |

## 9. Nachtrag M5.6: Treffen in deiner Nähe, Galerie nach dem Treffen, Check-in

Stand: 2026-11-16, Modul M5.6 (`docs/reports/phase-5/m5.6-contract.md` §4–§6, §12). Diese Absätze stehen in `web/database/data/legal/privacy.{de,en}.md` (Abschnitt 7 „Treffen“ und Abschnitt 20 „Mitteilungen …“ – vorher 18 –, Speicherdauer-Zeile der Tagesgrenze). Bestehende Installationen bekommen sie mit `2026_12_29_100300_publish_phase_5_privacy_update` (siehe §8). Seit dem Review gilt: Fotos erst ab dem Ende des Treffens (SF-5); die E-Mail fragt den Schalter beim Versand erneut.

| Änderung | Grund (was gebaut wurde, Stelle im Code) |
|---|---|
| § 7: „Neue Treffen in deiner Nähe“ – höchstens einmal pro Woche, donnerstags ab 18 Uhr, Treffen der nächsten 14 Tage im Umkreis von 50 km um die selbst gewählte Region, nie der Gerätestandort; voreingestellt aus; Abmeldelink in jeder E-Mail | `App\Services\Events\SendNearbyEventsDigest`, `events:nearby-digest`; `NotificationPrefs::TYPES['event_nearby']` (alle Wege aus); Abmeldeseite `/abbestellen/treffen/{member}` (signiert, 60 Tage; GET fragt nur, POST über den Knopf oder RFC 8058 One-Click schaltet ab); Konfiguration `speedclub.events.nearby_*` |
| § 7: „Fotos nach dem Treffen“ – Organisator und Zugesagte/Eingecheckte, bis 14 Tage nach dem Ende; Fotos von Teilnehmenden erst nach Freigabe sichtbar; Ablehnungsgrund nur für die hochladende Person; Bilddateien abgelehnter Fotos nach 7 Tagen gelöscht; Kennzeichen-Schalter gilt | `event_photos`, `UploadEventPhoto`, `ReviewEventPhoto`, `EventHousekeeping` (`gallery_rejected_purge_days`); Flag `events.gallery` (aus) |
| § 7: „Check-in“ – gespeichert nur wer und wann, nie Standort, Gerät oder IP; „War dabei“ erst nach dem Ende und abschaltbar; Organisator sieht nur die Zahl | `event_checkins` (keine Spalte für Ort, Gerät, IP; `EventCheckinPrivacyTest`), `event_checkin_codes`; Flag `events.checkin` (aus) |
| § 18: neue Treffen in deiner Nähe unter derselben Tagesgrenze (höchstens ein Push am Tag mit Spots, Abzeichen, Car of the Day, Einladungen; nie 22–8 Uhr) | `SocialPushLimiter::TYPES` |

Offener Punkt für die Prüfung: [[Prüfung: „Neue Treffen in deiner Nähe“ per E-Mail – Servicemitteilung oder Werbung (§ 7 UWG); Einwilligung liegt durch das ausdrückliche Einschalten vor]]. Speicherdauer: Galeriefotos mit dem Treffen bzw. bis zum Löschen durch die hochladende Person (dann 30 Tage für die private Originaldatei wie jedes Foto); Check-ins mit dem Treffen oder dem Konto; Check-in-Codes höchstens 6 Minuten (täglich bereinigt).

## 10. Forum und Shop in der Datenschutzerklärung (BL-21)

Stand: 2026-11-16 (Review M5.6/M5.7 SF-7). In `web/database/data/legal/privacy.{de,en}.md`, ausgeliefert mit `2026_12_29_100300_publish_phase_5_privacy_update`.

| Änderung | Grund (was gebaut wurde, Stelle im Code) |
|---|---|
| Neuer Abschnitt 19 „Forum“: Lesen ohne Konto, Schreiben mit Konto; gespeichert werden Themen und Antworten mit Text, Fotos, Schlagwörtern und Verknüpfungen, Erwähnungen, „Hilfreich“-Markierungen, Abos und Suchbegriffe aus Titel, Text, Schlagwörtern, Kategorie und Fahrzeug | ADR-526, `m5.8-contract.md` §1, D6 (`forum_threads.search_keys`, `title_keys`) |
| Abschnitt 19: Vormoderation bei Konten jünger als 3 Tage oder ohne bestätigte Adresse; Begründung einer Ablehnung nur für die Person; Meldungen nach DSA | `speedclub.forum.premoderation_days` (im Test gegen die Konfiguration geprüft), D4 |
| Abschnitt 19: „Hilfreich“-Zahlen nur im Forum, nie wer markiert hat | 10 §7.2, ADR-506/526 |
| Abschnitt 19 und 25: Kontolöschung – eigene Beiträge mit ihren Texten, Markierungen und Abos gehen; ein Thema mit Antworten anderer behält Titel und Antworten ohne Namen; ein Thema ohne Antworten anderer wird gelöscht | D8 (`ForumAccountDeletion`); offen bei der Rechtsprüfung (OA-63), im Text als Platzhalter markiert |
| Tabelle Abschnitt 2: Zeilen „Forum“, „Aufrufe von Profilen und Fahrzeugen“, „Build-Erinnerungen und Wochenrückblick“; Garage mit dem Ziel „Saison 2027“ | M5.8, M5.7 |
| Abschnitt 3: Aufrufzahlen nie öffentlich, Ziel öffentlich; Forum öffentlich lesbar, Name und Profilbild bei Beiträgen | M5.7 (`VehiclePolicy::viewInsights`, `UserPolicy::viewInsights`), M5.8 |
| Abschnitt 22 Empfänger: „Externer Sticker-Shop“ ersetzt durch „Unser Online-Shop bei Shopify (Sticker und Merch)“ – erst nach Tippen auf „Im Shop kaufen“ oder „Sticker bestellen“, keine Daten über dich, keine Tracking-Parameter, Kauf vollständig beim Shop | ADR-524 (ein Shopify-Shop, Kauflinks nur auf dessen Domain, App baut keine URL), `m5.5-contract.md` („No tracking parameters are added“) |
| Abschnitt 22: keine weiteren Stellen auch für Aufrufe, Wochenrückblick und Forum; die Shop-Seiten zeigen nur unseren Katalog | M5.5, M5.7, M5.8 |
| Abschnitt 24 Speicherdauer: Tagesschlüssel, einzelne Aufrufe (90 Tage), Summen, Wochenrückblick (12 Wochen), Push-Zähler (14 Tage), letzte Build-Erinnerung, Forum-Beiträge und -Markierungen | `ViewRetention`, `RetentionPolicy::FIXED`, D8 |
| Abschnitt 25 Rechte: Export mit Forum (`forum.json`) und Aufrufen (`insights.json`); Löschen nennt das Forum; Einstellungen nennen Build-Erinnerungen und Wochenrückblick | `ExportContents` |

Weiterhin offen: [[Shop-Betreiber und Region benennen]] (OA-44), OA-63 (Forum-Titel nach Kontolöschung).

## 11. KI-Funktionen (M5.9)

Stand: 2026-11-17 (`docs/reports/phase-5/m5.9-contract.md` §6, Lead-Entscheidung D-3). In `web/database/data/legal/privacy.{de,en}.md` Abschnitt 23 „KI-Funktionen“ und Abschnitt 24 (Speicherdauer); ausgeliefert mit `2026_12_31_200200_publish_phase_5_ai_privacy` (gleiches Muster wie §8: nur über einen unveränderten Seeder-Entwurf, `SEEDED` enthält auch die Fassung, die `2026_12_29_100300` veröffentlicht hat; keine erneute Zustimmung; Audit `legal.published`).

| Änderung | Grund (Stelle im Code) |
|---|---|
| „Herstellerangaben und Teile“: an den KI-Anbieter gehen nur Katalognamen (Fahrzeug) bzw. die getippte Teile-Eingabe und Kategorie; Vorschlag 180 Tage für alle Mitglieder mit dem Modell, Zuordnung 30 Tage ohne Personenbezug; übernommene Werte „Herstellerangabe (KI-Vorschlag)“, bis geändert; nur Teile aus dem Katalog | `SuggestVehicleSpecs`, `ai_spec_suggestions`, `SpecProvenance` (`vehicle_specs.ai_fields`); `MatchProduct`, `ai_text_normalisations`; `speedclub.ai.{spec_cache_days, normalisation_cache_days}` |
| „Zusammenfassungen im Forum“: Titel und Text öffentlicher Beiträge ohne Namen, Erwähnungen, Links, Fotos gehen an den Anbieter; gelöscht mit dem Thema und sobald ein verwendeter Beitrag entfernt/gelöscht wird; bei Blockierung nicht angezeigt; Rechtsgrundlage lit. f als Entwurf | `ForumSummaries` (`plain()`, `sweep()`, `forReader()`), `forum_thread_summaries`, `forum:summaries` |
| Speicherdauer: drei neue Zeilen | `RetentionPolicy::FIXED` (`ai_spec_suggestions` 180, `ai_text_normalisations` 30, `forum_thread_summaries` mit dem Thema), `ai:prune` |

Neuer Platzhalter: [[Prüfen: Rechtsgrundlage und Information für Forenbeiträge, die für Zusammenfassungen an den KI-Anbieter gehen (OA-35)]] (Anwalt). Tests: `Phase5AiPrivacyTest`.

