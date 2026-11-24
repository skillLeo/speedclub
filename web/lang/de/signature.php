<?php

// M2.7 signature features (02_PRODUCT_SPEC §5): compare, share cards, the car-show placard.
return [
    'compare' => [
        'same_build' => 'Wähle zum Vergleichen einen anderen Build.',
    ],
    'share_card' => [
        'photo' => 'Wähle eins der Fotos dieses Builds.',
        'text_characters' => 'Nur Buchstaben, Ziffern und Satzzeichen, keine Emojis.',
        'text_length' => 'Höchstens :max Zeichen.',
        'mods' => '{1} :count Mod|[2,*] :count Mods',
    ],
    'placard' => [
        'title' => 'Build-Blatt',
        'specs' => 'Technik',
        'mods' => 'Modifikationen',
        'more_mods' => '{1} und eine weitere Modifikation|[2,*] und :count weitere Modifikationen',
        'no_mods' => 'Noch keine Modifikationen hinzugefügt.',
        'scan' => 'Scannen für alle Fotos, Teile und den Verlauf',
        'code' => 'Code :code',
        'owner' => 'Build von @:name',
        'disclaimer' => 'Angaben des Besitzers, keine rechtliche Prüfung.',
    ],
];
