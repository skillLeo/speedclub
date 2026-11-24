<?php

// M5.9e Season Wrapped (10 §16.5, m5.9e contract §3–§4): the server's words in the payload and on the card images. Du, kurz, keine
// Wörter über Tempo oder Rennen. Die Build-Spirit-Namen sind Eigennamen und bleiben in beiden Sprachen gleich.
return [
    'season' => [
        'saison' => 'Saison :year',
        'jahr' => 'Jahr :year',
    ],
    'intro' => [
        'saison' => [
            'title' => 'Deine Saison :year',
            'subtitle' => 'Vom 1. März bis zum 31. Oktober: deine Saison in der Garage, auf Treffen und auf der Straße.',
        ],
        'jahr' => [
            'title' => 'Dein Jahr :year',
            'subtitle' => 'Zwölf Monate Garage, Treffen und Spots.',
        ],
    ],
    'percentile' => 'Top :value %',
    'spirit' => [
        'shakotan_artist' => [
            'title' => 'Shakotan Artist',
            'explanation' => 'Fahrwerk und Räder machen :share % deiner dokumentierten Mods aus. Bei dir zählt die Stance.',
        ],
        'engine_purist' => [
            'title' => 'Engine Purist',
            'explanation' => 'Motor, Abgasanlage und Antrieb machen :share % deiner dokumentierten Mods aus, an der Optik hast du nichts verändert.',
        ],
        'detail_perfectionist' => [
            'title' => 'Detail Perfectionist',
            'explanation' => 'Innenraum, Elektronik und Licht machen :share % deiner dokumentierten Mods aus. Du steckst im Detail.',
        ],
        'daily_hero' => [
            'title' => 'Daily Hero',
            'explanation' => ':logs Wartungseinträge in :months Monaten: Dein Auto wird gefahren und gepflegt.',
        ],
        'restomod_romantic' => [
            'title' => 'Restomod Romantic',
            'explanation' => 'Dein :car, Baujahr :year, mit :mods Mods: klassische Linie, moderne Teile.',
        ],
        'track_day_tactician' => [
            'title' => 'Track-Day Tactician',
            'explanation' => '{1} Du warst bei einem organisierten Trackday dabei: abgesperrte Strecke, klare Regeln.|[2,*] Du warst bei :count organisierten Trackdays dabei: abgesperrte Strecke, klare Regeln.',
        ],
    ],
    // The server's card images (GET me/wrapped/{season}/cards/{n}.png).
    'card' => [
        'spots' => [
            'eyebrow' => 'Gespottet',
            'cars' => '{1} 1 Auto in deinem Dex|[2,*] :count Autos in deinem Dex',
            'rarest' => 'Seltenster Fund',
        ],
        'scans' => [
            'eyebrow' => 'Scans deiner Sticker',
            'views' => ':count Aufrufe deiner Seiten',
            'top_city' => 'Die meisten davon in :city',
        ],
        'score' => [
            'eyebrow' => 'Build Score',
            'stage' => 'Von Stufe :from auf Stufe :to',
            'same_stage' => 'Stufe :stage',
        ],
        'top_mod' => [
            'eyebrow' => 'Dein Top-Mod',
        ],
        'treffen' => [
            'eyebrow' => '{1} Treffen besucht|[2,*] Treffen besucht',
        ],
        'build_spirit' => [
            'eyebrow' => 'Dein Build Spirit',
        ],
        'percentile' => [
            'eyebrow' => 'Build Score in :bundesland',
        ],
    ],
];
