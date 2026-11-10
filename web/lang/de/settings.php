<?php

// M2.5 settings API: validation and error texts of SET-03 to SET-13 and AUTH-11. Screens carry their own copy (mobile i18n).
return [
    'password_wrong' => 'Das Passwort stimmt nicht.',
    'password_locked' => 'Das Passwort wurde zu oft falsch eingegeben. Versuch es in :time noch einmal.',
    'code_required' => 'Gib den Code aus deiner Authenticator-App oder einen Wiederherstellungscode ein.',
    'code_wrong' => 'Dieser Code stimmt nicht. Nimm den aktuellen Code aus deiner Authenticator-App oder einen unbenutzten Wiederherstellungscode.',
    'email' => [
        'same' => 'Das ist schon die Adresse deines Kontos.',
        'unavailable' => 'Diese Adresse kann nicht verwendet werden. Wähle eine andere E-Mail-Adresse.',
        'nothing_pending' => 'Es wartet keine Änderung deiner E-Mail-Adresse. Fordere zuerst einen Code an.',
    ],
    'two_factor' => [
        'already_on' => 'Der Zwei-Faktor-Schutz ist schon eingeschaltet.',
        'not_on' => 'Der Zwei-Faktor-Schutz ist nicht eingeschaltet.',
        'nothing_pending' => 'Die Einrichtung ist nicht mehr aktiv. Starte sie noch einmal.',
        'needs_verified_email' => 'Bestätige zuerst deine E-Mail-Adresse, dann kannst du den Zwei-Faktor-Schutz einschalten.',
    ],
    'sessions' => [
        'current' => 'Das ist das Gerät, das du gerade benutzt. Um dich hier abzumelden, nutze „Abmelden“.',
        'browser' => 'Browser',
        'browser_on' => ':browser auf :os',
    ],
    'export' => [
        'busy' => 'Gerade werden sehr viele Exporte erstellt. Versuch es in einer Stunde noch einmal.',
        'readme' => [
            'title' => 'SPEED CLUB – dein Datenexport',
            'created' => 'Erstellt am :date für @:username (:email).',
            'intro' => 'Diese ZIP-Datei enthält die Daten, die SPEED CLUB zu deinem Konto speichert (Art. 15 und 20 DSGVO). Die Dateien sind JSON (UTF-8) und lassen sich mit jedem Texteditor öffnen.',
            'files' => [
                'profile.json' => 'Profil: E-Mail-Adresse, Benutzername, Name, Ort, Bio, Status, Mitglied seit.',
                'settings.json' => 'Einstellungen: Sprache, Design, Leistungsanzeige, Privatsphäre, Mitteilungen, Zwei-Faktor-Schutz an oder aus.',
                'consents.json' => 'Zustimmungen: Versionen von AGB und Datenschutz, Zeitpunkte, Marketing-Einwilligung.',
                'vehicles.json' => 'Fahrzeuge mit technischen Daten, Modifikationen, Verlauf und QR-Codes, auch Entwürfe und gelöschte (innerhalb der 30 Tage).',
                'photos.json' => 'Alle Fotos, die du hochgeladen hast; die Originale liegen im Ordner photos/.',
                'follows.json' => 'Wem du folgst und wer dir folgt (nur Benutzernamen).',
                'blocks.json' => 'Konten, die du blockiert hast.',
                'saves.json' => 'Builds, die du gespeichert hast.',
                'conversations/' => 'Deine Unterhaltungen und die Nachrichten, die du sehen kannst, in Dateien zu je 50 Unterhaltungen. Andere Mitglieder nur mit Benutzernamen; null steht für ein gelöschtes Mitglied.',
                'notifications/' => 'Deine Mitteilungen, in Dateien zu je 500.',
                'reports.json' => 'Meldungen, die du geschickt hast.',
                'support_tickets.json' => 'Deine Anfragen an den Support.',
                'devices.json' => 'Angemeldete Geräte mit Name, Plattform und Datum.',
                'moderation_decisions.json' => 'Entscheidungen des Teams zu deinen Inhalten, mit Begründung.',
                'appeals.json' => 'Deine Einsprüche gegen Entscheidungen.',
                'security_events.json' => 'Dein Sicherheitsprotokoll: Anmeldungen auf neuen Geräten, Änderungen an Passwort, E-Mail-Adresse und Zwei-Faktor-Schutz, mit Datum und Gerätename, ohne IP-Adresse.',
                'reactions.json' => 'Deine Reaktionen auf Nachrichten.',
                'push_devices.json' => 'Geräte, die Mitteilungen bekommen, mit Plattform und Datum.',
                'browser_sessions.json' => 'Angemeldete Browser mit Browser, System und letzter Nutzung.',
            ],
            'not_included' => 'Nicht enthalten: dein Passwort und deine Zwei-Faktor-Schlüssel (nur als Prüfwert gespeichert), Fotos, die andere Mitglieder dir geschickt haben, und die Daten anderer Mitglieder. IP-Adressen speichern wir zu Mitgliedern nicht.',
            'staff_copy' => 'Kopie für das SPEED-CLUB-Team (Vier-Augen-Freigabe): ohne Nachrichtentexte, Chat-Fotos und Reaktionen. Zu jeder Unterhaltung stehen nur Gesprächspartner, Ordner, Daten und Anzahlen darin.',
            'questions' => 'Fragen? Schreib uns an :support.',
        ],
        'cooldown' => 'Du kannst einmal in 24 Stunden einen Export anfordern. Der nächste ist ab dem :date Uhr möglich.',
    ],
];
