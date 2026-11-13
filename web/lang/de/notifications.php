<?php

// Push texts of M2.2, rendered in the recipient's language by App\Services\Notifications\NotificationTexts. The app renders the list rows
// (HOME-02) itself from type, actors and actor_count. Never message content (ADR-035).
return [
    'title' => 'SPEED CLUB',
    'new_follower' => '{1} @:name folgt dir jetzt.|{2} @:name und ein weiteres Mitglied folgen dir jetzt.|[3,*] @:name und :count weitere folgen dir jetzt.',
    'followed_published' => [
        'vehicle' => '@:name hat einen neuen Build veröffentlicht: :vehicle',
        'update' => '@:name hat ein Update zu :vehicle veröffentlicht.',
    ],
    'build_saved' => '{1} Ein Mitglied hat letzte Woche deinen Build :vehicle gespeichert.|[2,*] :count Mitglieder haben letzte Woche deinen Build :vehicle gespeichert.',
    // M2.6, urgent: names nothing of the decision; the app opens SAFE-01.
    'moderation_decision' => 'Wir haben eine Entscheidung zu deinen Inhalten oder deinem Konto getroffen. Tippe für die Begründung.',
    // M2.7 [SIG]: scans in total, never who scanned.
    'qr_milestone' => 'Dein QR-Code an :vehicle wurde schon :count-mal gescannt.',
    'hu_au_reminder' => 'Die HU/AU für :vehicle ist im :month fällig.',
    // M3.3: the member's catalogue request (ADM-14). In-app only; the app renders the row itself.
    'catalog_request' => [
        'accepted' => 'Dein Fahrzeug ist jetzt im Katalog: :vehicle.',
        'rejected' => 'Deine Katalog-Anfrage für :vehicle haben wir nicht übernommen. Tippe für die Begründung.',
    ],
    // Phase 3 (SET-15): the team answered a support request. In-app only; the app renders the row itself, never the answer's text.
    // M4.7 (09 §8.4): the login alert, pushed to the account's other devices. Names the device only.
    'security_new_device' => 'Neue Anmeldung bei SPEED CLUB auf :device. Warst du das nicht? Tippe, um dein Konto zu sichern.',
    'support_reply' => 'Das Support-Team hat auf deine Anfrage :reference geantwortet.',
    // The e-mail of the HU/AU reminder, only when switched on in SET-09.
    'hu_au_mail' => [
        'subject' => 'HU/AU für :vehicle im :month',
        'heading' => 'Bald ist HU/AU fällig',
        'intro' => 'Die HU/AU für :vehicle ist im :month fällig. Denk rechtzeitig an einen Termin.',
        'action' => 'Fahrzeug öffnen',
        'note' => 'Du bekommst diese E-Mail, weil du sie unter Einstellungen › Mitteilungen eingeschaltet hast. Dort kannst du sie auch wieder ausschalten.',
    ],
    // M4.11 (09 §8.17): names who and which build, never a count for anybody but the owner, never what was written.
    'reaction' => [
        'build_update' => '{1} @:name hat auf dein Update zu :vehicle reagiert.|{2} @:name und ein weiteres Mitglied haben auf dein Update zu :vehicle reagiert.|[3,*] @:name und :count weitere haben auf dein Update zu :vehicle reagiert.',
        'vehicle' => '{1} @:name hat auf deinen Build :vehicle reagiert.|{2} @:name und ein weiteres Mitglied haben auf deinen Build :vehicle reagiert.|[3,*] @:name und :count weitere haben auf deinen Build :vehicle reagiert.',
    ],
    'mention' => [
        'update' => '@:name hat dich in einem Update zu :vehicle erwähnt.',
        'comment' => '@:name hat dich in einem Kommentar zu :vehicle erwähnt.',
    ],
    'comment' => [
        'update' => '{1} @:name hat dein Update zu :vehicle kommentiert.|{2} @:name und ein weiteres Mitglied haben dein Update zu :vehicle kommentiert.|[3,*] @:name und :count weitere haben dein Update zu :vehicle kommentiert.',
        'reply' => '@:name hat auf deinen Kommentar zu :vehicle geantwortet.',
    ],
    'vehicle_follower' => '{1} @:name folgt jetzt deinem Build :vehicle.|{2} @:name und ein weiteres Mitglied folgen jetzt deinem Build :vehicle.|[3,*] @:name und :count weitere folgen jetzt deinem Build :vehicle.',
    // M4.12 (09 §8.17): the event's title and start, never an update's text or a rejection reason in a push.
    'event_review' => [
        'approved' => '„:title“ ist freigegeben und jetzt sichtbar.',
        'rejected' => '„:title“ wurde nicht freigegeben. Den Grund findest du beim Treffen.',
    ],
    'event_promoted' => 'Ein Platz ist frei geworden: Du bist bei „:title“ jetzt dabei.',
    'event_reminder' => [
        '24h' => 'Morgen um :time Uhr: „:title“.',
        '2h' => 'In zwei Stunden geht es los: „:title“ um :time Uhr.',
    ],
    'event_update' => [
        'update' => 'Neues vom Organisator zu „:title“.',
        'changed' => 'Zeit oder Ort von „:title“ haben sich geändert.',
    ],
    'event_cancelled' => '„:title“ wurde abgesagt.',
    'event_reminder_mail' => [
        'subject_24h' => 'Morgen: :title',
        'subject_2h' => 'In zwei Stunden: :title',
        'heading' => 'Dein Treffen steht an',
        'intro' => '„:title“ beginnt am :date um :time Uhr. Ort, Regeln und Updates findest du beim Treffen.',
        'action' => 'Treffen öffnen',
        'note' => 'Du bekommst diese E-Mail, weil du bei diesem Treffen zugesagt und Erinnerungen per E-Mail unter Einstellungen › Mitteilungen eingeschaltet hast.',
    ],
    // M4.13 (09 §8.8): maintenance reminders, the owner's own vehicle and item (MaintenanceTexts); SET-09 "Fälligkeiten".
    'maintenance_due' => [
        'items' => [
            'service' => 'Der Service',
            'oil_change' => 'Der Ölwechsel',
            'brake_fluid' => 'Der Bremsflüssigkeitswechsel',
        ],
        'custom' => '„:title“',
        'date' => ':item für :vehicle ist am :date fällig.',
        'today' => ':item für :vehicle ist heute fällig.',
        'km' => ':item für :vehicle ist bei :km fällig.',
        'undated' => ':item für :vehicle steht an.',
        'hu_au' => 'Die HU/AU für :vehicle ist im :month fällig.',
        'tyres_winter' => 'Von O bis O: Zeit für Winterreifen an :vehicle. Reifenwechsel bis :date.',
        'tyres_summer' => 'Von O bis O: Zeit für Sommerreifen an :vehicle. Reifenwechsel bis :date.',
        'insurance' => 'Stichtag :date: Bis dahin kannst du die Kfz-Versicherung für :vehicle kündigen und wechseln.',
    ],
    'maintenance_mail' => [
        'subject' => 'Fällig: Wartung für :vehicle',
        'heading' => 'Bald ist etwas fällig',
        'action' => 'Wartung öffnen',
        'note' => 'Du bekommst diese E-Mail, weil du E-Mails zu Fälligkeiten unter Einstellungen › Mitteilungen eingeschaltet hast. Dort kannst du sie auch wieder ausschalten.',
    ],
];
