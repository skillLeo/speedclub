<?php

// M5.9e Season Wrapped (10 §16.5, m5.9e contract §3–§4): the server's words in the payload and on the card images. Short, no words
// about speed or racing. The Build Spirit names are proper names and stay the same in both languages.
return [
    'season' => [
        'saison' => 'Season :year',
        'jahr' => 'Year :year',
    ],
    'intro' => [
        'saison' => [
            'title' => 'Your :year season',
            'subtitle' => 'From 1 March to 31 October: your season in the garage, at meets and out on the street.',
        ],
        'jahr' => [
            'title' => 'Your :year',
            'subtitle' => 'Twelve months of garage, meets and spots.',
        ],
    ],
    'percentile' => 'Top :value%',
    'spirit' => [
        'shakotan_artist' => [
            'title' => 'Shakotan Artist',
            'explanation' => 'Suspension and wheels make up :share% of your documented mods. Stance is what counts for you.',
        ],
        'engine_purist' => [
            'title' => 'Engine Purist',
            'explanation' => 'Engine, exhaust and drivetrain make up :share% of your documented mods, and you left the looks untouched.',
        ],
        'detail_perfectionist' => [
            'title' => 'Detail Perfectionist',
            'explanation' => 'Interior, electronics and lighting make up :share% of your documented mods. The details are your thing.',
        ],
        'daily_hero' => [
            'title' => 'Daily Hero',
            'explanation' => ':logs maintenance entries across :months months: your car gets driven and looked after.',
        ],
        'restomod_romantic' => [
            'title' => 'Restomod Romantic',
            'explanation' => 'Your :year :car with :mods mods: classic lines, modern parts.',
        ],
        'track_day_tactician' => [
            'title' => 'Track-Day Tactician',
            'explanation' => '{1} You took part in an organised track day: a closed circuit with clear rules.|[2,*] You took part in :count organised track days: a closed circuit with clear rules.',
        ],
    ],
    // The server's card images (GET me/wrapped/{season}/cards/{n}.png).
    'card' => [
        'spots' => [
            'eyebrow' => 'Spotted',
            'cars' => '{1} 1 car in your Dex|[2,*] :count cars in your Dex',
            'rarest' => 'Rarest find',
        ],
        'scans' => [
            'eyebrow' => 'Scans of your stickers',
            'views' => ':count views of your pages',
            'top_city' => 'Most of them in :city',
        ],
        'score' => [
            'eyebrow' => 'Build Score',
            'stage' => 'From stage :from to stage :to',
            'same_stage' => 'Stage :stage',
        ],
        'top_mod' => [
            'eyebrow' => 'Your top mod',
        ],
        'treffen' => [
            'eyebrow' => '{1} Meet attended|[2,*] Meets attended',
        ],
        'build_spirit' => [
            'eyebrow' => 'Your Build Spirit',
        ],
        'percentile' => [
            'eyebrow' => 'Build Score in :bundesland',
        ],
    ],
];
