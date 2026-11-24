<?php

// M5.9c Build Score: rank lines ("#4 von 61 EK9 in Deutschland", "#2 in NRW") and the share card.
return [
    'region' => [
        'germany' => 'Deutschland',
    ],
    // Short names for the rank line; the long ones are in enums.php.
    'bundesland' => [
        'BW' => 'Baden-Württemberg', 'BY' => 'Bayern', 'BE' => 'Berlin', 'BB' => 'Brandenburg', 'HB' => 'Bremen', 'HH' => 'Hamburg',
        'HE' => 'Hessen', 'MV' => 'MV', 'NI' => 'Niedersachsen', 'NW' => 'NRW', 'RP' => 'Rheinland-Pfalz', 'SL' => 'Saarland',
        'SN' => 'Sachsen', 'ST' => 'Sachsen-Anhalt', 'SH' => 'Schleswig-Holstein', 'TH' => 'Thüringen',
    ],
    'card' => [
        'label' => 'Build Score',
        'stage' => 'Stufe :stage',
        'dex' => 'Dex Nr. :number',
    ],
    'before_after' => [
        'photo_limit' => 'Ein Vorher/Nachher hat genau zwei Fotos: vorher und nachher.',
        'one_pair' => 'Ein Vorher/Nachher hat genau ein Paar.',
        'one_mod' => 'Ein Vorher/Nachher zeigt höchstens einen Mod.',
    ],
];
