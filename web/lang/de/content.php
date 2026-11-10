<?php

// M3.5 Brand, content, configuration: validation and server texts of the admin Actions (ADM-28…38) and the member re-consent.
return [
    'upload' => [
        'type' => 'Bitte lade ein JPEG-, PNG- oder WebP-Bild hoch.',
        'unreadable' => 'Das Bild lässt sich nicht lesen. Bitte lade es erneut hoch.',
        'too_many_pixels' => 'Das Bild ist zu groß. Bitte lade es mit höchstens 12 Megapixeln hoch.',
        'too_small' => 'Das Bild ist zu klein. Es braucht mindestens :width × :height Pixel.',
    ],
    'brand' => [
        'accent' => 'Wähle eine der geprüften Akzentfarben.',
        'asset_kind' => 'Dieses Bild passt nicht zu diesem Platz.',
        'focal' => 'Der Fokuspunkt muss im Bild liegen.',
        'hero_contrast' => 'Logo oder Text wären auf diesem Foto nicht gut lesbar (Kontrast :ratio:1, nötig :minimum:1). Wähle einen anderen Fokuspunkt oder ein dunkleres Foto.',
    ],
    'home' => [
        'ends_before_start' => 'Das Ende muss nach dem Beginn liegen.',
        'filters' => 'Diese Filter ergeben keine gültige Suche.',
        'vehicles' => 'Wähle mindestens ein Fahrzeug.',
        'vehicle_missing' => 'Dieses Fahrzeug ist nicht öffentlich sichtbar.',
        'too_many_live' => 'Höchstens :max Builds dürfen gleichzeitig hervorgehoben sein (hier :count).',
    ],
    'announcements' => [
        'ends_before_start' => 'Das Ende muss nach dem Beginn liegen.',
        'cta_label' => 'Der Button braucht eine Beschriftung.',
    ],
    'remote' => [
        'min_above_latest' => 'Die Mindestversion darf nicht über der aktuellen Version liegen.',
        'maintenance_message' => 'Für den Wartungsmodus braucht es eine Nachricht.',
    ],
    'rate_limits' => [
        'unknown' => 'Unbekannte Limits: :names.',
    ],
    'org' => [
        'field' => 'Dieser Wert ist nicht erlaubt.',
        'size' => 'Die Angaben sind zu umfangreich.',
    ],
    'flags' => [
        'empty' => 'Es gibt keine Änderung.',
    ],
    'approvals' => [
        'changed' => 'Die Änderung wurde seit der Anfrage geändert oder verworfen.',
    ],
    'templates' => [
        'unknown_variables' => 'Diese Platzhalter gibt es hier nicht: :names.',
        'plural_forms' => 'Behalte die Anzahl der Varianten (durch | getrennt) bei.',
        'test_subject' => '[Test] :subject',
        'test_heading' => 'Testversand: :key',
    ],
    'consent' => [
        'outdated' => 'Diese Fassung ist nicht mehr aktuell. Bitte lade die neue Fassung.',
    ],
];
