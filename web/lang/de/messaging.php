<?php

// M2.4 messaging: validation texts, push texts and the e-mail digest. Pushes never quote a message unless the member turned previews on
// (ADR-035); requests never do. The digest never quotes one.
return [
    'photo_unknown' => 'Dieses Foto gibt es nicht mehr. Lade es noch einmal hoch.',
    'photo_not_ready' => 'Das Foto wird noch verarbeitet. Versuch es gleich noch einmal.',
    'vehicle_unavailable' => 'Dieses Fahrzeug kannst du gerade nicht teilen.',
    'recipient_self' => 'Du kannst dir nicht selbst schreiben.',
    'pin_limit' => 'Du kannst höchstens :max Unterhaltungen anheften.',
    'push' => [
        'new_message' => 'Neue Nachricht von @:name',
        'message_request' => '@:name möchte dir schreiben',
        'photo' => 'Foto',
        'vehicle' => 'Fahrzeug',
    ],
    'digest' => [
        'subject' => 'Ungelesene Nachrichten bei SPEED CLUB',
        'heading' => 'Du hast ungelesene Nachrichten',
        'intro' => '{1} In einer Unterhaltung wartet seit über 12 Stunden eine Nachricht auf dich.|[2,*] In :count Unterhaltungen warten seit über 12 Stunden Nachrichten auf dich.',
        'action' => 'Nachrichten öffnen',
        'note' => 'Du bekommst diese E-Mail, weil du die Zusammenfassung für Nachrichten eingeschaltet hast. Abschalten kannst du sie in der App unter Einstellungen › Mitteilungen.',
    ],
];
