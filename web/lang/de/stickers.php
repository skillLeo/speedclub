<?php

// M5.4 Sticker (10 §2, m5.4-contract). Slug lines are for the print partner and always German.
return [
    'templates' => [
        'classic' => 'Logo, QR-Code und dein Name – der Sticker für die Heckscheibe.',
        'minimal' => 'Nur QR-Code und kleiner Schriftzug.',
        'banner' => 'Streifen für die Frontscheibe, QR-Code am Ende auf Wunsch.',
        'plate' => 'Im Format eines Kennzeichens, dein Name groß.',
        'vertical_jdm' => 'Senkrechte Spalte mit Logo und QR-Code.',
        'round' => 'Runder Badge mit QR-Code in der Mitte.',
    ],
    'colourway_hints' => [
        'white' => 'Für dunkle Scheiben',
        'black' => 'Für helle Lackierung',
        'white_red' => 'Für dunkle Scheiben, mit Akzent in Signalrot',
    ],
    'order_soon' => 'Bestellung bald verfügbar',
    'validation' => [
        'custom_line_max' => 'Die eigene Zeile darf höchstens :max Zeichen haben.',
        'one_line' => 'Die eigene Zeile muss in eine Zeile passen.',
        'unprintable' => 'Diese Zeichen können wir nicht drucken.',
        'white_needs_transparent' => 'Weißer Druck braucht transparente Folie: Auf weißer Folie wäre er nicht zu sehen.',
        'mirrored_needs_transparent' => 'Gespiegelter Druck geht nur auf transparenter Folie, für die Innenseite der Scheibe.',
        'base_revision' => 'Lade den Sticker neu und versuch es noch einmal.',
    ],
    'slug' => [
        'mirrored' => 'gespiegelt (Innenseite)',
        'code' => 'Code :code',
        'code_inactive' => '(nicht mehr aktiv)',
        'no_code' => 'ohne QR-Code',
        'inks' => 'Weiß = Druckfarbe Weiß · Schwarz = K 100 · Signalrot ≈ C0 M100 Y81 K4 · Magenta-Linie = Schneidekontur, nicht drucken',
        'proof' => 'Ansicht :reference – nicht drucken',
    ],
];
