<?php

// M5.9c Build Score: rank lines ("#4 of 61 EK9 in Germany", "#2 in NRW") and the share card.
return [
    'region' => [
        'germany' => 'Germany',
    ],
    // Short names for the rank line; the long ones are in enums.php.
    'bundesland' => [
        'BW' => 'Baden-Württemberg', 'BY' => 'Bavaria', 'BE' => 'Berlin', 'BB' => 'Brandenburg', 'HB' => 'Bremen', 'HH' => 'Hamburg',
        'HE' => 'Hesse', 'MV' => 'MV', 'NI' => 'Lower Saxony', 'NW' => 'NRW', 'RP' => 'Rhineland-Palatinate', 'SL' => 'Saarland',
        'SN' => 'Saxony', 'ST' => 'Saxony-Anhalt', 'SH' => 'Schleswig-Holstein', 'TH' => 'Thuringia',
    ],
    'card' => [
        'label' => 'Build Score',
        'stage' => 'Stage :stage',
        'dex' => 'Dex no. :number',
    ],
    'before_after' => [
        'photo_limit' => 'A before/after has exactly two photos: before and after.',
        'one_pair' => 'A before/after has exactly one pair.',
        'one_mod' => 'A before/after shows one mod at most.',
    ],
];
