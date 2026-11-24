<?php

// M5.4 Sticker (10 §2, m5.4-contract). Slug lines are for the print partner and always German.
return [
    'templates' => [
        'classic' => 'Logo, QR code and your name – the sticker for the rear window.',
        'minimal' => 'Just the QR code and a small wordmark.',
        'banner' => 'A strip for the windscreen, with the QR code at the end if you like.',
        'plate' => 'Licence-plate proportions with your name large.',
        'vertical_jdm' => 'A vertical column with the logo and QR code.',
        'round' => 'A round badge with the QR code in the middle.',
    ],
    'colourway_hints' => [
        'white' => 'For dark glass',
        'black' => 'For light paint',
        'white_red' => 'For dark glass, with a Signal Red accent',
    ],
    'order_soon' => 'Ordering available soon',
    'validation' => [
        'custom_line_max' => 'Your own line can have at most :max characters.',
        'one_line' => 'Your own line has to fit on one line.',
        'unprintable' => 'We cannot print these characters.',
        'white_needs_transparent' => 'White print needs transparent vinyl: on white vinyl it would not show.',
        'mirrored_needs_transparent' => 'Mirrored print only works on transparent vinyl, for the inside of the window.',
        'base_revision' => 'Reload the sticker and try again.',
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
