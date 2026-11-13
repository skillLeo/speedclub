<?php

return [
    'code_note' => 'Der Code gilt :minutes Minuten. Du hast das nicht angefordert? Dann kannst du diese E-Mail ignorieren.',
    // M4.6 passwordless e-mail codes (09 §8.1).
    'email_code' => [
        'action' => 'Anmelden',
        'same_device' => 'Der Button funktioniert nur auf dem Gerät, auf dem du den Code angefordert hast.',
        'sign_in' => [
            'subject' => ':code ist dein SPEED CLUB Code',
            'heading' => 'Dein Code zum Anmelden',
            'intro' => 'Gib diesen Code in der App ein oder tipp auf „Anmelden“.',
        ],
        'sign_up' => [
            'subject' => ':code ist dein SPEED CLUB Code',
            'heading' => 'Willkommen im SPEED CLUB',
            'intro' => 'Mit diesem Code legst du dein Konto an. Gib ihn in der App ein oder tipp auf „Anmelden“.',
        ],
        'link' => [
            'subject' => ':code bestätigt die Verknüpfung',
            'heading' => ':provider mit deinem Konto verbinden',
            'intro' => 'Jemand möchte :provider mit deinem SPEED CLUB Konto verbinden. Warst du das, gib diesen Code in der App ein. Sonst ignorier diese E-Mail, dann bleibt alles, wie es ist.',
        ],
        'reauth' => [
            'subject' => ':code ist dein Bestätigungscode',
            'heading' => 'Bestätige, dass du es bist',
            'intro' => 'Du änderst gerade etwas an der Sicherheit deines Kontos. Gib diesen Code in der App ein.',
        ],
        'change_email' => [
            'subject' => ':code bestätigt deine neue E-Mail-Adresse',
            'heading' => 'Neue E-Mail-Adresse bestätigen',
            'intro' => 'Gib diesen Code in der App ein, um deine neue Adresse zu bestätigen.',
        ],
    ],
    'verification' => [
        'subject' => ':code ist dein SPEED CLUB Code',
        'heading' => 'Bestätige deine E-Mail-Adresse',
        'intro' => 'Gib diesen Code in der App ein, um dein Konto zu bestätigen.',
        'action' => 'Im Browser bestätigen',
    ],
    'reset' => [
        'subject' => 'Dein Code zum Zurücksetzen des Passworts',
        'heading' => 'Neues Passwort festlegen',
        'intro' => 'Gib diesen Code in der App ein und wähle ein neues Passwort.',
        'action' => 'Im Browser zurücksetzen',
    ],
    'exists' => [
        'subject' => 'Du hast schon ein SPEED CLUB Konto',
        'heading' => 'Für diese Adresse gibt es schon ein Konto',
        'intro' => 'Jemand wollte mit dieser E-Mail-Adresse ein Konto erstellen. Das Konto gibt es bereits. Wenn du das warst, melde dich an oder setze dein Passwort zurück.',
        'sign_in' => 'Anmelden',
        'reset' => 'Passwort vergessen',
        'note' => 'Warst du das nicht? Dann musst du nichts tun. An deinem Konto hat sich nichts geändert.',
    ],
    'closing' => [
        'subject' => 'Dein SPEED CLUB Konto wird gerade gelöscht',
        'heading' => 'Diese Adresse ist noch belegt',
        'intro' => 'Jemand wollte mit dieser E-Mail-Adresse ein Konto erstellen. Das Konto dazu ist deaktiviert und wird innerhalb von :days Tagen nach dem Löschantrag endgültig gelöscht. Bis dahin kannst du die Adresse nicht neu verwenden.',
        'after' => 'Danach ist die Adresse wieder frei, und du kannst dich damit neu registrieren.',
        'note' => 'Du warst das nicht? Dann musst du nichts tun.',
    ],
    'email_change' => [
        'subject' => ':code ist dein Code für die neue Adresse',
        'heading' => 'Bestätige deine neue E-Mail-Adresse',
        'intro' => 'Du möchtest die E-Mail-Adresse deines SPEED CLUB Kontos auf diese Adresse ändern. Gib diesen Code in der App ein, um die Änderung abzuschließen.',
    ],
    'email_change_attempt' => [
        'subject' => 'Jemand wollte diese Adresse für ein anderes Konto nutzen',
        'heading' => 'Diese Adresse gehört schon zu deinem Konto',
        'intro' => 'Jemand wollte die E-Mail-Adresse eines anderen SPEED CLUB Kontos auf diese Adresse ändern. Das haben wir nicht zugelassen. An deinem Konto hat sich nichts geändert.',
        'note' => 'Du musst nichts tun. Wenn du dir Sorgen machst, schreib uns an :support.',
    ],
    'export' => [
        'subject' => 'Dein Datenexport ist fertig',
        'heading' => 'Deine Daten stehen zum Download bereit',
        'intro' => 'Dein Export von SPEED CLUB ist fertig: eine ZIP-Datei mit deinen Angaben als JSON und den Originalen deiner Fotos.',
        'valid' => 'Der Link gilt bis zum :date Uhr. Danach löschen wir die Datei, und du kannst einen neuen Export anfordern.',
        'ends' => 'Setzt du vorher dein Passwort zurück, änderst deine E-Mail-Adresse oder meldest ein Gerät ab, endet der Link. Einen neuen findest du dann in der App unter Einstellungen › Daten › Daten exportieren.',
        'action' => 'Export herunterladen',
        'note' => 'Du hast keinen Export angefordert? Dann schreib uns sofort an :support. Gib den Link nicht weiter: Wer ihn hat, kann die Datei laden.',
    ],
    'support' => [
        'subject' => 'Wir haben deine Anfrage erhalten',
        'heading' => 'Danke, deine Nachricht ist angekommen',
        'intro' => 'Wir haben deine Anfrage zum Thema „:category“ erhalten und melden uns meist innerhalb von zwei Werktagen. Hast du uns aus der App geschrieben, findest du die Antwort dort unter Einstellungen › Hilfe & FAQ › Deine Anfragen. Sonst antworten wir per E-Mail.',
        'reference' => 'Deine Vorgangsnummer: :reference',
        'note' => 'Du hast uns nicht geschrieben? Dann kannst du diese E-Mail ignorieren.',
    ],
    'security' => [
        'browser' => 'einem Browser',
        'action' => 'Passwort zurücksetzen',
        'note' => 'Warst du das nicht? Tipp in der App unter Einstellungen › Sicherheit auf „Das war ich nicht“. Wir melden dann alle Geräte ab und unser Support meldet sich bei dir.',
        // M4.7 (09 §8.4): login alerts and new ways in.
        'when' => 'Zeitpunkt: :time',
        'when_where' => 'Zeitpunkt: :time · in der Nähe von :place',
        'secure_action' => 'Das war ich nicht',
        'secure_note' => 'Warst du das nicht? Tipp auf „Das war ich nicht“. Wir melden dann alle Geräte ab und unser Support meldet sich bei dir. Warst du es selbst, musst du nichts tun.',
        'removed' => 'Wir haben entfernt, was nach der gemeldeten Anmeldung hinzugekommen ist: :items. War etwas davon von dir, richte es nach der Anmeldung neu ein.',
        'account_secured' => [
            'subject' => 'Dein Konto wurde gesichert',
            'heading' => 'Wir haben dein Konto gesichert',
            'intro' => 'Du hast eine Anmeldung als „Das war ich nicht“ gemeldet. Alle Geräte und Browser sind jetzt abgemeldet. Deine Anfrage hat die Nummer :reference; unser Support meldet sich bei dir.',
            'after' => 'Melde dich wieder an und ändere dein Passwort, falls du eins hast. Prüfe unter Einstellungen › Anmeldung & Passkeys, welche Anmeldewege mit deinem Konto verbunden sind.',
            'note' => 'Fragen? Schreib uns an :support.',
            'action' => 'Support schreiben',
        ],
        'email_code_locked' => [
            'subject' => 'Zu viele falsche Codes',
            'heading' => 'Anmeldung mit Code vorübergehend gesperrt',
            'intro' => 'Für dein Konto wurde zu oft ein falscher Anmeldecode eingegeben. Zu deinem Schutz nehmen wir für 15 Minuten keine Codes an.',
        ],
        'provider_linked' => [
            'subject' => 'Neue Anmeldemethode verbunden',
            'heading' => 'Eine Anmeldemethode wurde verbunden',
            'intro' => 'Mit deinem Konto ist jetzt eine neue Anmeldemethode verbunden (:device).',
        ],
        'provider_unlinked' => [
            'subject' => 'Anmeldemethode entfernt',
            'heading' => 'Eine Anmeldemethode wurde entfernt',
            'intro' => 'Von deinem Konto wurde eine Anmeldemethode entfernt (:device).',
        ],
        'passkey_added' => [
            'subject' => 'Neuer Passkey für dein Konto',
            'heading' => 'Ein Passkey wurde hinzugefügt',
            'intro' => 'Für dein Konto wurde gerade ein Passkey angelegt (:device).',
        ],
        'passkey_removed' => [
            'subject' => 'Passkey entfernt',
            'heading' => 'Ein Passkey wurde entfernt',
            'intro' => 'Von deinem Konto wurde gerade ein Passkey entfernt (:device).',
        ],
        'passkey_rejected' => [
            'subject' => 'Passkey-Anmeldung abgelehnt',
            'heading' => 'Wir haben eine Passkey-Anmeldung abgelehnt',
            'intro' => 'Bei einer Anmeldung mit deinem Passkey (:device) sah es so aus, als käme sie von einer Kopie. Wir haben sie abgelehnt. Entferne den Passkey unter Einstellungen › Anmeldung & Passkeys und leg ihn neu an.',
        ],
        'new_device' => [
            'subject' => 'Neue Anmeldung bei SPEED CLUB',
            'heading' => 'Neue Anmeldung auf einem Gerät',
            'intro' => 'Dein Konto wurde gerade auf :device angemeldet, das wir noch nicht kannten.',
        ],
        'password_changed' => [
            'subject' => 'Dein Passwort wurde geändert',
            'heading' => 'Dein Passwort wurde geändert',
            'intro' => 'Das Passwort deines Kontos wurde gerade geändert. Alle Geräte wurden abgemeldet.',
            // SET-04 keeps the device the member changed it on.
            'intro_kept' => 'Das Passwort deines Kontos wurde gerade auf :device geändert. Andere Browser wurden abgemeldet, die App bleibt auf deinen anderen Geräten angemeldet.',
            'intro_others_signed_out' => 'Das Passwort deines Kontos wurde gerade auf :device geändert. Alle anderen Geräte wurden abgemeldet.',
        ],
        'email_changed' => [
            'subject' => 'Deine E-Mail-Adresse wurde geändert',
            'heading' => 'Deine E-Mail-Adresse wurde geändert',
            'intro' => 'Die E-Mail-Adresse deines Kontos wurde gerade geändert. Diese Nachricht geht an die bisherige Adresse.',
            // M3.2: support changed it after checking the member's identity; both addresses get this.
            'intro_staff' => 'Unser Support-Team hat die E-Mail-Adresse deines Kontos auf deinen Wunsch geändert, nachdem wir deine Identität geprüft haben. Diese Nachricht geht an die bisherige und an die neue Adresse.',
            // The reset code would go to the new, maybe hijacked address: this mail sends the member to support instead.
            'note' => 'Warst du das nicht? Setz dein Passwort in diesem Fall nicht selbst zurück: Der Code ginge an die neue Adresse. Tipp stattdessen in der App unter Einstellungen › Sicherheit auf „Das war ich nicht“ oder schreib uns an :support. Wir sichern dann dein Konto.',
            'action' => 'Support schreiben',
        ],
        'two_factor_changed' => [
            'subject' => 'Zwei-Faktor-Schutz geändert',
            'heading' => 'Dein Zwei-Faktor-Schutz wurde geändert',
            'intro' => 'Der Zwei-Faktor-Schutz deines Kontos wurde gerade ein- oder ausgeschaltet.',
            'intro_enabled' => 'Der Zwei-Faktor-Schutz deines Kontos ist jetzt eingeschaltet. Bei jeder Anmeldung fragen wir nach einem Code aus deiner Authenticator-App.',
            'intro_disabled' => 'Der Zwei-Faktor-Schutz deines Kontos wurde gerade ausgeschaltet. Für die Anmeldung reicht jetzt wieder deine Anmeldung ohne Code.',
            'intro_recovery_codes' => 'Für dein Konto wurden gerade neue Wiederherstellungscodes erstellt. Die alten gelten nicht mehr.',
            // M3.2: support reset it (four-eyes) after checking the member's identity.
            'intro_reset_by_staff' => 'Unser Support-Team hat den Zwei-Faktor-Schutz deines Kontos auf deinen Wunsch zurückgesetzt. Für die Anmeldung reicht jetzt wieder deine Anmeldung ohne Code; du kannst den Schutz unter Einstellungen › Sicherheit neu einrichten.',
        ],
        'verification_failed' => [
            'subject' => 'Fehlgeschlagener Bestätigungsversuch',
            'heading' => 'Falsche Eingabe bei deinem Konto',
            'intro' => 'Auf :device wurde gerade eine Sicherheitsabfrage deines Kontos falsch beantwortet.',
            'intro_second_factor' => 'Das Passwort deines Kontos wurde gerade auf :device richtig eingegeben, der Code des Zwei-Faktor-Schutzes aber falsch.',
            'intro_password' => 'Auf :device wurde gerade für eine Änderung an deinem Konto ein falsches Passwort eingegeben.',
            'intro_locked' => 'Der Code des Zwei-Faktor-Schutzes wurde zu oft falsch eingegeben. Bis du dein Passwort per E-Mail zurücksetzt, kann sich niemand mehr bei deinem Konto anmelden.',
        ],
        'recovery_code_used' => [
            'subject' => 'Anmeldung mit Wiederherstellungscode',
            'heading' => 'Ein Wiederherstellungscode wurde verwendet',
            'intro' => 'Dein Konto wurde gerade auf :device mit einem Wiederherstellungscode angemeldet. Dir bleiben :count unbenutzte Codes. Neue Codes erstellst du unter Einstellungen › Sicherheit › Zwei-Faktor-Schutz.',
        ],
        'sessions_revoked' => [
            'subject' => 'Geräte wurden abgemeldet',
            'heading' => 'Geräte wurden von deinem Konto abgemeldet',
            'intro' => 'Auf :device wurden gerade andere Geräte oder Browser von deinem Konto abgemeldet.',
            // M3.2: support signed every device out.
            'intro_staff' => 'Unser Team hat dein Konto zu deinem Schutz auf allen Geräten und in allen Browsern abgemeldet. Melde dich wieder an.',
        ],
        'deletion_requested' => [
            'subject' => 'Dein Konto wird gelöscht',
            'heading' => 'Die Löschung deines Kontos wurde beantragt',
            'intro' => 'Dein Konto ist ab sofort deaktiviert: Profil und Fahrzeuge sind nicht mehr zu sehen, deine QR-Sticker funktionieren nicht mehr und alle Geräte sind abgemeldet. Spätestens in :days Tagen löschen wir das Konto mit allen Fotos endgültig.',
            'after' => 'Die Löschung lässt sich nicht zurücknehmen. In Unterhaltungen sieht die andere Person deine Nachrichten weiterhin, als Absender steht dann „Gelöschtes Mitglied“. Hast du vorher einen Datenexport angefordert, kannst du ihn bis zu 7 Tage lang über den Link aus der Export-E-Mail herunterladen.',
            'note' => 'Warst du das nicht? Dann schreib uns sofort an :support.',
            'action' => 'Support schreiben',
        ],
    ],
    // M3.2: staff took a vehicle's QR code down or issued a new one (ADM-19). :title is the build's title.
    'qr_staff' => [
        'revoked' => [
            'subject' => 'Wir haben deinen QR-Code gesperrt',
            'heading' => 'Dein QR-Code ist gesperrt',
            'intro' => 'Unser Team hat den QR-Code deines Builds :title gesperrt. Wer den Sticker scannt, sieht jetzt „nicht mehr gültig“.',
            'after' => 'Einen neuen Code kann nur unser Team ausgeben. Schreib uns, wenn du einen brauchst.',
        ],
        'reissued' => [
            'subject' => 'Dein Build hat einen neuen QR-Code',
            'heading' => 'Neuer QR-Code für deinen Build',
            'intro' => 'Unser Team hat für deinen Build :title einen neuen QR-Code ausgegeben. Der alte Sticker gilt nicht mehr.',
            'after' => 'Den neuen Sticker kannst du in der App unter deinem Build herunterladen und drucken.',
        ],
        'note' => 'Fragen dazu? Schreib uns an :support.',
    ],
];
