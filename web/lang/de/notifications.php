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
    'support_reply' => 'Das Support-Team hat auf deine Anfrage :reference geantwortet.',
    // The e-mail of the HU/AU reminder, only when switched on in SET-09.
    'hu_au_mail' => [
        'subject' => 'HU/AU für :vehicle im :month',
        'heading' => 'Bald ist HU/AU fällig',
        'intro' => 'Die HU/AU für :vehicle ist im :month fällig. Denk rechtzeitig an einen Termin.',
        'action' => 'Fahrzeug öffnen',
        'note' => 'Du bekommst diese E-Mail, weil du sie unter Einstellungen › Mitteilungen eingeschaltet hast. Dort kannst du sie auch wieder ausschalten.',
    ],
];
