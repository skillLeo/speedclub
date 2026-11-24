# DEPLOY_ALLINKL — SPEED CLUB auf ALL-INKL „Private“ (ohne SSH, ohne Cronjob)

> Kundenentscheidung 2026-11-23: kein Tarifwechsel. ALL-INKL Private hat **kein SSH** und **keine Cronjobs**. Deshalb läuft alles über **FileZilla (FTPS)**, den **Browser** und **cron-job.org** (ADR-539). Es gibt keinen Schritt mehr, der eine Kommandozeile auf dem Server braucht.
> Domain: `joinspeedclub.com` · Ordner auf dem Server: `/speedclub/` · Document Root: `/speedclub/public` · Mail: `w021473b.kasserver.com`, Port 465 (SSL).
> Grundlage: `docs/DEPLOY.md` (was die Befehle tun), `docs/10_CLIENT_ROUND_1.md` §10, Go-Live-Liste `docs/reports/phase-5/m5.11-golive-checklist.md`.

Deutsch: [A Überblick](#a-überblick) · [B Paket](#b-paket-bauen-entwickler) · [C Datenbank](#c-datenbank-in-kas) · [D Domain-Pfad](#d-domain-pfad) · [E SSL + HTTPS](#e-ssl-und-https-weiterleitung) · [F Mail](#f-mail-no-reply-spf-dkim) · [G Hochladen](#g-hochladen-mit-filezilla-ftps) · [H .env](#h-env-anlegen) · [I Einrichtung](#i-einrichtung-im-browser) · [J cron-job.org](#j-zeitplaner-über-cron-joborg) · [K Smoke-Test](#k-smoke-test-nach-dem-upload) · [L Updates](#l-updates) · [M Rollback](#m-rollback) · [N Probleme](#n-wenn-etwas-nicht-klappt)

English: [EA Overview](#ea-overview) · [EB Package](#eb-build-the-package-developer) · [EC Database](#ec-database-in-kas) · [ED Domain path](#ed-domain-path) · [EE SSL + HTTPS](#ee-ssl-and-https-redirect) · [EF Mail](#ef-mail-no-reply-spf-dkim) · [EG Upload](#eg-upload-with-filezilla-ftps) · [EH .env](#eh-create-the-env) · [EI Setup](#ei-setup-in-the-browser) · [EJ cron-job.org](#ej-scheduler-via-cron-joborg) · [EK Smoke test](#ek-smoke-test-after-the-upload) · [EL Updates](#el-updates) · [EM Rollback](#em-rollback) · [EN Problems](#en-when-something-goes-wrong)

---

# Deutsch

## A Überblick

| Wer | Was |
|---|---|
| Entwickler | baut das Paket (`sh scripts/deploy-allinkl.sh`), liefert Zip + SHA-256, hilft beim Smoke-Test |
| Besitzer (du) | klickt in KAS, lädt mit FileZilla hoch, legt die `.env` an und tippt alle Passwörter selbst, startet die Einrichtung im Browser, legt den Job bei cron-job.org an |

**Drei Adressen, die du brauchst** (die Platzhalter `<…>` sind deine eigenen Zufallswerte aus der `.env`, sie stehen nirgends sonst):

| Adresse | Wofür |
|---|---|
| `https://joinspeedclub.com/internal/setup/<SETUP_TOKEN>` | Einrichtung: Migrationen, Grunddaten, Foto-Ordner, Caches, Prüfung. Danach gesperrt, bis ein neuer `SETUP_TOKEN` in der `.env` steht |
| `https://joinspeedclub.com/internal/maintenance/<SETUP_TOKEN>/on` bzw. `/off` | Wartungsmodus an/aus (für Updates) |
| `https://joinspeedclub.com/internal/cron/<CRON_TOKEN>` | der Zeitplaner, jede Minute von cron-job.org aufgerufen |

**Zufallswerte erzeugen** (Mac, Programm „Terminal“, für `SETUP_TOKEN` und `CRON_TOKEN` je einmal, zwei **verschiedene** Werte):
```
php -r "echo bin2hex(random_bytes(32)), PHP_EOL;"
```
Die Ausgabe (64 Zeichen) direkt in den Passwortmanager und in die `.env` kopieren, nirgends sonst hin (nicht in Chat oder Mail).

**Reihenfolge:** C Datenbank → D Domain-Pfad → E SSL → F Mail → G Hochladen → H `.env` → I Einrichtung → J cron-job.org → K Smoke-Test.

## B Paket bauen (Entwickler)

```
sh scripts/deploy-allinkl.sh                                  # volles Paket (Erstinstallation)
sh scripts/deploy-allinkl.sh --since <voriges-allinkl.zip>    # zusätzlich ein Update-Paket nur mit geänderten Dateien
```
Ergebnis: `releases/web/allinkl/speedclub-allinkl-<version>-<datum>.zip` + `.sha256` (und mit `--since` die `-update-`Zip). Inhalt: der Ordner `speedclub/` mit `public/` (Document Root), `vendor/` (ohne Dev-Pakete, optimierter Autoloader), gebauten Assets, der Web-App unter `public/app`, der Ordnerstruktur von `storage/`, `public/.htaccess`, einer Sperr-`.htaccess` in `speedclub/` (falls der Domain-Pfad je falsch auf `/speedclub` zeigt), `.env.example` (Produktionsvorlage) und `ANLEITUNG-ALLINKL.txt`. **Keine** `.env`, keine Schlüssel. Das Skript bricht ab, wenn etwas davon fehlt oder doch eine `.env` drin wäre.

Vor einem öffentlichen Start: `legal placeholders: none` (sonst zeigen Impressum/Datenschutz noch `[[…]]`, OA-10).

Prüfen auf dem Mac (im Ordner der Zip): `shasum -a 256 -c speedclub-allinkl-….zip.sha256` → `OK`. Dann die Zip per Doppelklick entpacken: es entsteht der Ordner `speedclub`.

## C Datenbank in KAS

1. KAS (`https://kas.all-inkl.com`) → links **Datenbanken** → **Neue Datenbank anlegen**.
2. Beschreibung: `speedclub production`. Zeichensatz/Kollation: **utf8mb4** / `utf8mb4_unicode_ci`.
3. Passwort vergeben: langes Zufallspasswort aus dem Passwortmanager, nur Buchstaben, Ziffern, `-` und `_` (dann braucht es in der `.env` keine Anführungszeichen).
4. KAS zeigt danach **Datenbankname** (z. B. `d0xxxxxx`), **Benutzer** (meist gleich) und **Host** (meist `localhost`). Alle drei in den Passwortmanager; sie gehen in H in die `.env`.

## D Domain-Pfad

Der Webserver darf **nur** `/speedclub/public` ausliefern; `.env`, `storage`, `vendor` und der Code liegen eine Ebene darüber.

1. FileZilla (siehe G Schritt 1) → im Konto-Stamm den Ordner `speedclub` anlegen, darin `public` (leer). KAS verlangt, dass der Zielordner existiert.
2. KAS → **Domain** → bei `joinspeedclub.com` auf **Bearbeiten** → Feld **Ziel / Pfad** (Document Root): `/speedclub/public` → Speichern.
3. Gibt es `www.joinspeedclub.com` als eigene Subdomain: dasselbe Ziel `/speedclub/public` (oder in KAS eine Weiterleitung von `www` auf `https://joinspeedclub.com`).
4. **PHP-Version:** KAS → Domain → Bearbeiten → **PHP-Version**: die neueste 8.x, mindestens **8.3**. Speichern.

## E SSL und HTTPS-Weiterleitung

1. KAS → **Domain** → bei `joinspeedclub.com` das **Schloss-Symbol** bzw. **SSL-Schutz** → **Let's Encrypt** wählen → für `joinspeedclub.com` **und** `www.joinspeedclub.com` → Zertifikat anfordern. Dauert Minuten bis eine Stunde.
2. In denselben SSL-Einstellungen **„HTTPS erzwingen“ / „SSL-Weiterleitung“** einschalten → Speichern.
3. Prüfen: `https://joinspeedclub.com` zeigt ein gültiges Schloss; `http://joinspeedclub.com` leitet auf `https://` um (im Browser die Adresse mit `http://` eintippen).
4. Die App sendet HSTS selbst (`Strict-Transport-Security`, 1 Jahr, inkl. Subdomains). Deshalb **vor dem Start** sicherstellen, dass **jede** Subdomain, die ihr benutzt, ein Zertifikat hat.

## F Mail: no-reply, SPF, DKIM

1. KAS → **E-Mail** → **Postfächer** → **Neues Postfach**: `no-reply@joinspeedclub.com`, langes Zufallspasswort (Passwortmanager). Dieses Postfach ist der Absender der App.
2. KAS zeigt beim Postfach den **Login** (z. B. `m0xxxxxx`). In die `.env` kommt als `MAIL_USERNAME` zuerst dieser Login; klappt der Versand nicht, die volle Adresse.
3. **SPF:** KAS → **Domain** → **DNS-Einstellungen** von `joinspeedclub.com` → es darf genau **einen** TXT-Eintrag mit `v=spf1` geben; der ALL-INKL-Standard `v=spf1 a mx include:spf.kasserver.com ~all` passt.
4. **DKIM:** KAS → **E-Mail** → **DKIM** (oder in den DNS-Einstellungen) → für `joinspeedclub.com` **aktivieren**.
5. Der Test kommt im Smoke-Test (K Nr. 5): eine echte Anmeldung per E-Mail-Code. Optional zusätzlich `https://www.mail-tester.com` (Ziel ≥ 9/10): dort angezeigte Adresse in der Web-App bei „Registrieren“ eingeben, dann auf mail-tester „Dann prüfen“.

## G Hochladen mit FileZilla (FTPS)

1. FileZilla → **Datei → Servermanager → Neuer Server**:
   - Protokoll **FTP**, Verschlüsselung **„Explizites FTP über TLS erfordern“**
   - Server: `w021473b.kasserver.com` (steht in KAS unter **FTP**), Port leer lassen
   - Verbindungsart **Normal**, Benutzer und Passwort: der FTP-Zugang aus KAS → **FTP** (Hauptzugang oder ein eigener FTP-Benutzer mit Zugriff auf `/speedclub`)
   - Beim ersten Verbinden das Zertifikat bestätigen („Zertifikat immer vertrauen“).
2. FileZilla → **Server → Anzeige versteckter Dateien erzwingen** einschalten (sonst fehlen `.htaccess`-Dateien).
3. FileZilla → **Bearbeiten → Einstellungen → Übertragungen**: „Maximale Anzahl gleichzeitiger Übertragungen“ auf **8**.
4. Links (dein Mac): in den entpackten Ordner `speedclub` wechseln. Rechts (Server): in `/speedclub` wechseln.
5. Links **alles im Ordner `speedclub`** markieren (auch `.htaccess` und `.env.example`) → Rechtsklick → **Hochladen**. Bei der Frage „Datei existiert“: **Überschreiben**, „Immer diese Aktion verwenden“.
6. Dauer: rund 19 500 Dateien, meist 20–60 Minuten. Bricht etwas ab: unten im Reiter **Fehlgeschlagene Übertragungen** → alle markieren → **Zurücksetzen und wieder in die Warteschlange stellen**. Am Ende muss die Warteschlange leer sein und „Fehlgeschlagene Übertragungen: 0“ zeigen.
7. Prüfen: `https://joinspeedclub.com/.env` → 404, `https://joinspeedclub.com/RELEASES.md` → 404 (beides liegt außerhalb von `public`).

## H .env anlegen

Die `.env` enthält alle Zugangsdaten. **Du** legst sie an; sie wird nie gemailt, nie in Chat kopiert und nie ins Repository gelegt.

1. Auf dem Mac im Ordner `speedclub` die Datei `.env.example` kopieren und die Kopie `.env` nennen (im Finder: `Cmd + Shift + .` zeigt versteckte Dateien). Mit TextEdit öffnen (Format → **In reinen Text umwandeln**).
2. Diese Zeilen ausfüllen bzw. prüfen (Werte in `(…)` tippst du selbst):
```
APP_ENV=production
APP_DEBUG=false
APP_URL=https://joinspeedclub.com
APP_KEY=                       # LEER lassen: die Einrichtung erzeugt ihn und schreibt ihn hinein
FORCE_HTTPS=true
TRUSTED_HOSTS=www.joinspeedclub.com

DB_HOST=(aus C, meist localhost)
DB_DATABASE=(aus C)
DB_USERNAME=(aus C)
DB_PASSWORD=(aus C)

MAIL_MAILER=smtp
MAIL_SCHEME=smtps
MAIL_HOST=w021473b.kasserver.com
MAIL_PORT=465
MAIL_USERNAME=(Postfach-Login aus F)
MAIL_PASSWORD=(Postfach-Passwort aus F)
MAIL_FROM_ADDRESS=no-reply@joinspeedclub.com
SUPPORT_EMAIL=info@joinspeedclub.com
MODERATION_EMAIL=(Postfach, das täglich gelesen wird)
HEALTH_TO_ADDRESS=(dein Postfach)

SCHEDULER_INLINE=true
CRON_TOKEN=(Zufallswert 1, siehe A)
SETUP_TOKEN=(Zufallswert 2, siehe A)

STAFF_OWNER_EMAIL=(Postfach des Owners; mehrere Owner kommagetrennt, höchstens 3)
ADMIN_IP_ALLOWLIST=(eure festen IP-Adressen, kommagetrennt; leer = Admin von überall erreichbar)
BACKUP_ARCHIVE_PASSWORD=(langes Zufallspasswort)
TESTER_APK_URL=
DEMO_MEMBER_PASSWORD=
DEMO_STAFF_PASSWORD=
```
   Alle übrigen Zeilen der Vorlage so lassen (sie sind für Produktion vorbelegt und kommentiert).
3. Speichern. FileZilla: die Datei `.env` von links nach rechts in `/speedclub/` hochladen (neben `artisan`, **nicht** in `public`).
4. Rechte: Rechtsklick auf `/speedclub/.env` → **Dateiberechtigungen** → `600`. Zeigt die Einrichtung danach „Datenbank nicht erreichbar“ ohne Grund, `640` setzen.
5. Die lokale Kopie der `.env` danach vom Mac löschen (Papierkorb leeren); das Original steht im Passwortmanager bzw. auf dem Server.

**Später etwas in der `.env` ändern** (z. B. Mail-Login, IP-Liste): Datei per FileZilla herunterladen, ändern, hochladen, dabei einen **neuen** `SETUP_TOKEN` eintragen, dann die Einrichtung (I) einmal laufen lassen. Erst dann gilt die Änderung (die Einstellungen sind zwischengespeichert).

## I Einrichtung im Browser

1. Browser: `https://joinspeedclub.com/internal/setup/<SETUP_TOKEN>`. Die Seite zeigt Paket, Version und „Datenbank: leer“.
2. **Einrichtung starten** klicken und die Seite offen lassen (meist unter einer Minute). Sie führt aus: App-Schlüssel anlegen (nur wenn leer), Wartungsmodus an, Datenbank-Migrationen, **Grunddaten ohne Demo-Inhalte** (Katalog, Rechtstexte, Hilfe, Feature-Flags mit Produktionswerten, Einstellungen, Rollen und der Owner aus `STAFF_OWNER_EMAIL`, Städte, Dex-Sets, Abzeichen, Forum-Kategorien), Foto-Ordner (`public/storage`: Link, oder ein echter Ordner, wenn der Host Links verbietet), Caches, Wartungsmodus aus, Prüfung.
3. Ergebnis **„Fertig“** und unten im Protokoll die Prüfung: „No blockers“ heißt alles gut; „WARN“-Zeilen sind Hinweise (erwartet: Pusher, Backups, Cron-Herzschlag bis J erledigt ist, „Active Owner“ bis der erste Owner in Schritt 5 sein Passwort gesetzt hat).
4. Die Adresse ist danach **gesperrt** (404). Für jede weitere Einrichtung einen neuen `SETUP_TOKEN` in die `.env` schreiben.
5. **Erster Admin:** am Ende der Einrichtung bekommt jedes Owner-Konto aus `STAFF_OWNER_EMAIL` (eine Adresse oder mehrere, kommagetrennt, höchstens 3) **automatisch einen einmal nutzbaren Link zum Passwort-Setzen** per E-Mail (60 Min. gültig; die Seite nennt die Adresse gekürzt, z. B. `i***@joinspeedclub.com`). Niemand sieht oder tippt ein Passwort für ihn. Link öffnen → Passwort setzen → `https://joinspeedclub.com/admin/login` → anmelden. Abgelaufen? „Passwort vergessen?“ auf `/admin/login` schickt einen neuen. Zwei-Faktor empfohlen (Authenticator-App; **Wiederherstellungscodes** in den Passwortmanager), unter **Governance › Organisation › Governance** ist „2FA für Admin-Konten“ standardmäßig *Optional*. Das „Vier-Augen-Prinzip“ ist standardmäßig aus (ADR-540): alle Aktionen laufen sofort und stehen im Audit-Log.
6. **Firmendaten:** als **Owner** im Admin **Governance › Organisation** → Felder ausfüllen (Firmenname, Anschrift, Vertretung, E-Mail, Register, USt-IdNr. …) → **Speichern** → bestätigen und ggf. das Passwort eingeben (kein Grund nötig, ADR-540) → danach `https://joinspeedclub.com/impressum` öffnen: die `[[…]]`-Stellen zeigen jetzt die Angaben. Ein Konto mit der Rolle **Admin** sieht die Felder nur (Hinweis „Nur ein Owner kann die Firmendaten ändern“).

Bei „Nicht fertig“: das Protokoll lesen. „Datenbank nicht erreichbar“ → `DB_*` in der `.env` prüfen. Ein abgebrochener Lauf darf einfach neu gestartet werden; jeder Schritt verträgt die Wiederholung.

### I2 Feature-Flags in Produktion

Die Einrichtung legt die Flags mit ihren **Produktionswerten** an (`FeatureFlagSeeder`, Spalte „production“ von 09 §8.18); vorhandene Flags ändert sie nie. Gemessen im Ablauftest (`scripts/dev/allinkl-flow-test.sh`, 2026-11-23): **an** sind u. a. `forum`, `auth.email_code`, `auth.password_login`, `build_reactions`, `build_prompts`, `collections`, `insights`, `mentions`, `vehicle_follow`, `weekly_recap`, `theme_reveal`, `nav.native_tabs`; **aus** u. a. `editorial_samples`, `shop`, `sticker_shop`, `events*`, `businesses`, `parts_catalogue`, `crews`, `cotd_voting`, `build_comments`, `membership`, `premium.enabled`, `web_push`, `wrapped*`, `auth.passkeys`, `auth.google`, `auth.apple`, alle `ai.*` und alle `sig.*` (Signature-Funktionen wie Share-Karten oder Kennzeichen-Unschärfe).

| Flag | Produktion | Wann einschalten (Admin → **Plattform › Feature-Flags**) |
|---|---|---|
| `editorial_samples` | aus (bleibt) | nie mit Beispielinhalten; nur mit echten, freigegebenen Builds |
| `shop`, `sticker_shop` | aus | wenn der Shopify-Shop öffentlich ist und echte Produkte hat (OA-44) |
| `forum` | an | — (Meldungen landen in der Moderation) |
| `crews`, `cotd_voting`, `build_comments` | aus | wenn ihr sie für echte Mitglieder freigebt (Runde 4/5 lief auf Staging) |
| `sig.share_cards`, `sig.plate_blur` und die übrigen `sig.*` | aus | einzeln, nach eurer Freigabe (auf Staging an) |
| `events`, `events.create` | aus | nach Freigabe der Treffen-Regeln |
| `auth.passkeys`, `auth.google`, `auth.apple` | aus | nach dem jeweiligen Einrichten und Test |
| `web_push` | aus | braucht Schlüssel, die nur per Kommandozeile entstehen: bleibt auf ALL-INKL Private aus |
| `ai.*` | aus | nur mit KI-Schlüssel und Datenschutz-Freigabe |
| `wrapped`, `wrapped.countdown` | aus | zur ersten Saison-Veröffentlichung |

## J Zeitplaner über cron-job.org

ALL-INKL Private hat keine Cronjobs. Die App hat dafür eine Adresse, die ein externer Dienst jede Minute aufruft: Sie antwortet sofort mit `204` und arbeitet danach höchstens 50 Sekunden (fällige Aufgaben, Mail-Warteschlange, Herzschlag für die Prüfung).

1. `https://cron-job.org` → kostenloses Konto → **Cronjobs → Cronjob erstellen**.
2. Titel: `SPEED CLUB`. **Adresse (URL):**
   ```
   https://joinspeedclub.com/internal/cron/<CRON_TOKEN>
   ```
   (`<CRON_TOKEN>` = Zufallswert 1 aus der `.env`, genau so, ohne Leerzeichen.)
3. **Ausführungszeitplan:** „Jede Minute“ (`* * * * *`).
4. **Erweitert:** Methode `GET`, Zeitüberschreitung **30 Sekunden**, „Als Erfolg werten“: Status `204`; Benachrichtigung bei Fehlschlag an deine Adresse einschalten.
5. Speichern → **Testlauf**: Ergebnis `204 No Content`. Ein `404` heißt: Token falsch oder `CRON_TOKEN` fehlt in der `.env`; ein `503`: Wartungsmodus ist an.
6. Nach 2–3 Minuten zeigt die Prüfung „Cron heartbeat OK“ (neuer `SETUP_TOKEN` → Einrichtung → Protokoll) und im Admin unter **Governance › Systemzustand** der Zeitplan „In Ordnung“.

Der Token steht in deinem cron-job.org-Konto und im Zugriffsprotokoll des Hosts. Kommt er in falsche Hände: neuen `CRON_TOKEN` in die `.env`, neuen `SETUP_TOKEN`, Einrichtung laufen lassen, URL bei cron-job.org anpassen.

## K Smoke-Test nach dem Upload

Am besten vom Handy im Mobilfunknetz (nicht im Büro-WLAN). Zu jeder Zeile Haken, Datum, Ergebnis notieren und dem Entwickler schicken.

| # | Prüfung | Erwartet |
|---|---|---|
| 1 | `https://joinspeedclub.com` | Startseite (Deutsch), Schloss gültig |
| 2 | `https://joinspeedclub.com/up` | eine schlichte Seite „Application up“ |
| 3 | `https://joinspeedclub.com/app` | Web-App: Willkommen / Anmelden |
| 4 | Registrieren mit **E-Mail-Code** (eigene Adresse, z. B. Gmail) | Code-Mail in < 1 Minute im **Posteingang** (nicht Spam), Absender `SPEED CLUB <no-reply@joinspeedclub.com>`; Anmeldung klappt |
| 5 | In der Web-App ein Fahrzeug anlegen und **veröffentlichen**, dann die öffentliche Seite `https://joinspeedclub.com/v/<slug>` (Link über „Teilen“) | Fahrzeugseite mit Foto und Daten; das Foto lädt |
| 6 | `https://joinspeedclub.com/admin/login` (von einer Adresse aus `ADMIN_IP_ALLOWLIST`) | Anmeldung mit Passwort + Zwei-Faktor-Code, Dashboard |
| 7 | `/admin` vom Handy im Mobilfunknetz (wenn `ADMIN_IP_ALLOWLIST` gesetzt) | 404 |
| 8 | cron-job.org → Verlauf | jede Minute `204` |
| 9 | `/impressum`, `/datenschutz`, `/agb` | ohne `[[…]]` |
| 10 | `/.env`, `/RELEASES.md`, `/internal/setup/<alter SETUP_TOKEN>` | 404 |
| 11 | `http://joinspeedclub.com` | Weiterleitung auf `https://` |

## L Updates

Der Entwickler liefert ein **Update-Paket** (`speedclub-allinkl-update-….zip`, nur geänderte und neue Dateien) und nennt besondere Schritte im Begleittext.

1. **Sicherung:** KAS → **Datenbanken** → bei der Datenbank **phpMyAdmin** → oben **Exportieren** → „Schnell“, SQL → **OK**. Die Datei aufbewahren (für M).
2. Neuen `SETUP_TOKEN` (A) erzeugen, die `.env` per FileZilla herunterladen, den Wert ersetzen, hochladen.
3. **Wartungsmodus an:** `https://joinspeedclub.com/internal/maintenance/<SETUP_TOKEN>/on` → „Wartungsmodus: AN“.
4. Update-Zip entpacken; mit FileZilla den **Inhalt** des Ordners `speedclub` nach `/speedclub/` hochladen, **Überschreiben**. Nichts vorher löschen. **Nie löschen:** `/speedclub/.env`, `/speedclub/storage`, `/speedclub/public/storage` (dort liegen die Fotos).
5. **Einrichtung:** `https://joinspeedclub.com/internal/setup/<SETUP_TOKEN>` → **Einrichtung starten** → „Fertig“. Sie schaltet den Wartungsmodus am Ende selbst aus.
6. Kurz-Smoke-Test: K Nr. 1, 3, 4, 8.
7. Optional: die Liste `UPDATE_DELETED.txt` aus dem Update nennt Dateien, die es nicht mehr gibt. Löschen ist nicht nötig (sie stören nicht).

Klappt die Einrichtung nicht und die Seite soll trotzdem wieder erreichbar sein: `…/internal/maintenance/<SETUP_TOKEN>/off`.

## M Rollback

1. Wartungsmodus an (L Schritt 3; dafür ggf. einen neuen `SETUP_TOKEN` setzen).
2. **Datenbank zurück:** phpMyAdmin → Datenbank wählen → alle Tabellen markieren → **Löschen**, dann **Importieren** → die Sicherung aus L Schritt 1 → **OK**.
3. **Code zurück:** das **vorige volle Paket** entpacken und wie in G hochladen (Überschreiben). `.env` und `storage` bleiben.
4. Neuen `SETUP_TOKEN`, Einrichtung (I) starten: sie schaltet den Wartungsmodus aus.
5. Notausstieg: in KAS das Domain-Ziel auf einen Ordner mit einer statischen Seite „Gleich zurück“ setzen.

Zusätzlich sichert ALL-INKL täglich selbst (KAS → **Datensicherung**). Die eingebauten App-Backups brauchen `proc_open`; die Prüfung meldet, ob es sie gibt.

## N Wenn etwas nicht klappt

| Bild | Ursache / Abhilfe |
|---|---|
| Weiße Seite oder „500“ direkt nach dem Upload | `.env` fehlt, liegt in `public` statt in `/speedclub`, oder hat Tippfehler; PHP-Version < 8.3 (D 4); Upload unvollständig (G 6: fehlgeschlagene Übertragungen) |
| `/internal/setup/…` = 404 | Token falsch, kürzer als 32 Zeichen, oder schon verbraucht: neuen `SETUP_TOKEN` in die `.env` |
| „Datenbank nicht erreichbar“ | `DB_HOST`, `DB_DATABASE`, `DB_USERNAME`, `DB_PASSWORD` mit KAS vergleichen |
| „APP_KEY konnte nicht geschrieben werden“ | `.env` ist schreibgeschützt: Rechte `600`/`640`; sonst den angezeigten Befehl auf dem Mac ausführen und `APP_KEY=…` selbst eintragen |
| Fotos laden nicht | im Protokoll der Einrichtung „public/storage“ lesen; `/speedclub/public/storage` darf nie gelöscht werden |
| Code-Mail kommt nicht | F 2 (anderer `MAIL_USERNAME`), Spam-Ordner; nach jeder `.env`-Änderung Einrichtung mit neuem Token |
| cron-job.org meldet Zeitüberschreitung | der Host gibt die Antwort erst nach der Arbeit frei: harmlos, der Lauf passiert trotzdem; Zeitüberschreitung auf 30 s lassen |
| Admin = 404 | eigene IP nicht in `ADMIN_IP_ALLOWLIST` (nach Änderung: neuer Token + Einrichtung) |
| Seite zeigt dauerhaft „Gleich zurück“ | `…/internal/maintenance/<SETUP_TOKEN>/off` (ggf. mit neuem Token) |

---

# English

## EA Overview

Client decision 2026-11-23: no plan upgrade. ALL-INKL Private has **no SSH** and **no cronjobs**, so everything runs through **FileZilla (FTPS)**, the **browser** and **cron-job.org** (ADR-539). No step needs a server shell.

| Who | What |
|---|---|
| Developer | builds the package (`sh scripts/deploy-allinkl.sh`), hands over zip + SHA-256, helps with the smoke test |
| Owner (you) | clicks in KAS, uploads with FileZilla, creates the `.env` and types every password, starts the setup in the browser, creates the cron-job.org job |

**Three addresses** (`<…>` are your own random values from the `.env`, kept nowhere else):

| Address | Purpose |
|---|---|
| `https://joinspeedclub.com/internal/setup/<SETUP_TOKEN>` | setup: migrations, required data, photo folder, caches, checks. Locked afterwards until the `.env` carries a new `SETUP_TOKEN` |
| `https://joinspeedclub.com/internal/maintenance/<SETUP_TOKEN>/on` or `/off` | maintenance mode on/off (updates) |
| `https://joinspeedclub.com/internal/cron/<CRON_TOKEN>` | the scheduler, called every minute by cron-job.org |

**Random values** (Mac Terminal, once for `SETUP_TOKEN` and once for `CRON_TOKEN`, two **different** values): `php -r "echo bin2hex(random_bytes(32)), PHP_EOL;"` — straight into the password manager and the `.env`, nowhere else.

**Order:** EC database → ED domain path → EE SSL → EF mail → EG upload → EH `.env` → EI setup → EJ cron-job.org → EK smoke test.

## EB Build the package (developer)

`sh scripts/deploy-allinkl.sh` (full package) or `… --since <previous-allinkl.zip>` (also an update zip with changed files only). Output: `releases/web/allinkl/speedclub-allinkl-<version>-<stamp>.zip` + `.sha256`. Contents: `speedclub/` with `public/` (document root), `vendor/` (no dev packages, optimised autoloader), built assets, the member web in `public/app`, the `storage/` structure, `public/.htaccess`, a deny-all `.htaccess` in `speedclub/`, `.env.example` (production template), `ANLEITUNG-ALLINKL.txt`. No `.env`, no keys: the script fails otherwise. Before a public launch `legal placeholders: none` (OA-10). On the Mac: `shasum -a 256 -c <zip>.sha256` → `OK`, then double-click to unzip.

## EC Database in KAS

KAS → **Datenbanken** → **Neue Datenbank anlegen** → description `speedclub production`, **utf8mb4** / `utf8mb4_unicode_ci`, a long random password (letters, digits, `-`, `_`). Note database name, user and host (usually `localhost`) in the password manager.

## ED Domain path

1. FileZilla: create `/speedclub/public` (empty) in the account root.
2. KAS → **Domain** → `joinspeedclub.com` → **Bearbeiten** → **Ziel / Pfad**: `/speedclub/public`. Same for `www` (or redirect `www` to `https://joinspeedclub.com`).
3. **PHP version** in the same form: newest 8.x, at least **8.3**.

## EE SSL and HTTPS redirect

KAS → Domain → **SSL** → **Let's Encrypt** for `joinspeedclub.com` and `www.joinspeedclub.com` → request; then switch on **"HTTPS erzwingen" / SSL redirect**. Check: valid padlock, `http://` redirects to `https://`. The app sends HSTS itself (1 year, subdomains included): every subdomain in use needs a certificate before launch.

## EF Mail: no-reply, SPF, DKIM

KAS → **E-Mail** → **Postfächer** → new mailbox `no-reply@joinspeedclub.com` (random password). `MAIL_USERNAME` = the mailbox login KAS shows (e.g. `m0xxxxxx`), else the full address. SPF: exactly one `v=spf1` TXT record (ALL-INKL default `v=spf1 a mx include:spf.kasserver.com ~all`). DKIM: KAS → E-Mail → **DKIM** → enable. Test = smoke test EK #4; optionally mail-tester.com (≥ 9/10) by registering its address in the web app.

## EG Upload with FileZilla (FTPS)

1. Site Manager → new site: protocol **FTP**, encryption **"Require explicit FTP over TLS"**, host `w021473b.kasserver.com`, logon type Normal, the FTP user from KAS → **FTP**; trust the certificate.
2. **Server → Force showing hidden files** (else `.htaccess` files are skipped). Settings → Transfers → 8 simultaneous transfers.
3. Local: the unzipped `speedclub` folder; remote: `/speedclub`. Select **everything inside** `speedclub` (incl. `.htaccess`, `.env.example`) → Upload → Overwrite, always.
4. About 19,500 files, 20–60 minutes. Failed transfers tab → reset and requeue until it shows 0.
5. Check: `https://joinspeedclub.com/.env` and `/RELEASES.md` → 404.

## EH Create the .env

1. On the Mac copy `speedclub/.env.example` to `.env` (Finder: `Cmd + Shift + .` shows hidden files), open with TextEdit as plain text.
2. Fill in the lines listed in **H** above (`APP_URL`, `APP_KEY` **empty** — the setup writes it, `FORCE_HTTPS=true`, `DB_*`, `MAIL_*`, `SCHEDULER_INLINE=true`, `CRON_TOKEN`, `SETUP_TOKEN`, `STAFF_OWNER_EMAIL`, `ADMIN_IP_ALLOWLIST`, `BACKUP_ARCHIVE_PASSWORD`, demo and tester values empty). Leave the other template lines as they are.
3. Upload it to `/speedclub/` (next to `artisan`, **not** into `public`), permissions `600` (`640` if the setup then cannot read it). Delete the local copy.
4. **Changing the `.env` later:** download, edit, set a **new** `SETUP_TOKEN`, upload, run the setup once: the config is cached and only then picks up the change.

## EI Setup in the browser

1. Open `https://joinspeedclub.com/internal/setup/<SETUP_TOKEN>` → it shows package, version and "Datenbank: leer".
2. **Einrichtung starten**; keep the page open (usually under a minute). It runs: APP_KEY (only when empty), maintenance on, migrations, **required data without demo content** (catalogue, legal texts, help, feature flags with their production values, config, roles and the Owner from `STAFF_OWNER_EMAIL`, cities, Dex sets, badges, forum categories), the photo folder (`public/storage`: a link, or a real folder where the host forbids links), caches (config/route/view/event), maintenance off, the doctor.
3. **"Fertig"** and "No blockers" in the log = done; WARN lines are notes (expected: Pusher, backups, cron heartbeat until EJ is done, "Active Owner" until the first Owner has set a password in step 5).
6. **Feature flags:** the setup creates every flag with its **production** value and never changes an existing one; table and when to switch which flag on: **I2** above (measured by `scripts/dev/allinkl-flow-test.sh`). `web_push` stays off on ALL-INKL Private (its keys need a shell).
4. The address is then locked (404) until a new `SETUP_TOKEN` is in the `.env`.
5. **First admin:** at the end of the setup every Owner of `STAFF_OWNER_EMAIL` (one address or several, comma-separated, at most 3) automatically gets a **one-time set-password link** by e-mail (60 min; the page names the address shortened). Nobody sees or types a password for them; expired → "Passwort vergessen?" on `/admin/login`. Two-factor recommended; "2FA für Admin-Konten" is *Optional* and the "Vier-Augen-Prinzip" off by default (ADR-540). Then, as an **Owner**, **Governance › Organisation**: fill in the company data → **Speichern** → confirm, password if asked (no reason) → `/impressum` shows it in place of the `[[…]]` placeholders. An **Admin** account can only read this page.

## EJ Scheduler via cron-job.org

The app answers `GET /internal/cron/<CRON_TOKEN>` with `204` at once and then works for at most 50 seconds (due tasks, the mail queue, the heartbeat the doctor reads). It is rate-limited (20 calls per minute and address) and answers 404 to a wrong token.

1. cron-job.org → free account → **Create cronjob**, title `SPEED CLUB`.
2. **URL:** `https://joinspeedclub.com/internal/cron/<CRON_TOKEN>`
3. Schedule: **every minute**. Advanced: method `GET`, timeout **30 s**, success = status `204`, failure notifications on.
4. **Test run** → `204 No Content` (`404` = wrong or missing token, `503` = maintenance mode on).
5. After 2–3 minutes the doctor shows "Cron heartbeat OK" and admin **Governance › Systemzustand** shows the schedule as OK.

If the token leaks: new `CRON_TOKEN` + new `SETUP_TOKEN` in the `.env`, run the setup, update the URL at cron-job.org.

## EK Smoke test after the upload

From a phone on mobile data; tick, date and result per line, send to the developer: see table **K** (home, `/up`, `/app`, sign-up with an **e-mail code** arriving in the inbox in < 1 minute, a published car page `/v/<slug>` with its photo, **admin login** with two-factor, `/admin` = 404 from outside the allow-list, cron-job.org history `204` every minute, legal pages without `[[…]]`, `/.env` + `/RELEASES.md` + the spent setup URL = 404, `http://` → `https://`).

## EL Updates

1. Backup: KAS → Datenbanken → **phpMyAdmin** → **Export** (quick, SQL); keep the file.
2. New `SETUP_TOKEN` into the `.env` (download, edit, upload).
3. `https://joinspeedclub.com/internal/maintenance/<SETUP_TOKEN>/on`.
4. Unzip the **update zip** (changed files only) and upload the **contents** of its `speedclub` folder to `/speedclub/`, overwrite. Delete nothing first; **never delete** `/speedclub/.env`, `/speedclub/storage`, `/speedclub/public/storage` (photos).
5. `https://joinspeedclub.com/internal/setup/<SETUP_TOKEN>` → **Einrichtung starten** → "Fertig" (switches maintenance off itself).
6. Short smoke test: EK #1, 3, 4, 8. `UPDATE_DELETED.txt` lists files that no longer exist; deleting them is optional.

Abandoned update: `…/internal/maintenance/<SETUP_TOKEN>/off`.

## EM Rollback

Maintenance on → phpMyAdmin: drop all tables, **Import** the backup from EL 1 → upload the **previous full package** (overwrite; `.env` and `storage` stay) → new `SETUP_TOKEN` → run the setup (switches maintenance off). Last resort: point the domain in KAS at a folder with a static "back soon" page. ALL-INKL keeps daily backups too (KAS → **Datensicherung**).

## EN When something goes wrong

See table **N** above (white page/500 after upload: `.env` missing or misplaced, PHP < 8.3, incomplete upload · setup 404: wrong, short or spent token · database unreachable: `DB_*` · APP_KEY not writable: permissions or set it by hand · photos missing: never delete `public/storage` · no code mail: `MAIL_USERNAME` variant, spam, new token + setup after `.env` edits · cron-job.org timeout: harmless, keep 30 s · admin 404: IP allow-list · stuck in maintenance: the `/off` URL).
