<?php

// M5.7 INS-01 "Statistiken" (10 §6.1, m5.7-contract §3.4). Nur Summen, nie wer angesehen hat. Weniger Aufrufe stehen ohne Prozent und
// ohne Wertung da (10 §16: kein schlechtes Gewissen). :subject ist „Dein E46“ oder „Deine Garage“.
return [
    'subject' => [
        'vehicle' => 'Dein :title',
        'account' => 'Deine Garage',
    ],
    'headline' => [
        'up' => '{1} :subject wurde diese Woche einmal angesehen – :percent % mehr als letzte Woche.|[2,*] :subject wurde diese Woche :count-mal angesehen – :percent % mehr als letzte Woche.',
        'down' => '{1} :subject wurde diese Woche einmal angesehen. Letzte Woche waren es :previous.|[2,*] :subject wurde diese Woche :count-mal angesehen. Letzte Woche waren es :previous.',
        'plain' => '{1} :subject wurde diese Woche einmal angesehen.|[2,*] :subject wurde diese Woche :count-mal angesehen.',
        'new' => '{1} Diese Woche wurde :subject_lower zum ersten Mal angesehen: einmal.|[2,*] Diese Woche wurde :subject_lower zum ersten Mal angesehen: :count-mal.',
        'zero' => 'Diese Woche noch keine Aufrufe. Teil deinen Build, damit ihn mehr Leute sehen.',
        'zero_account' => 'Diese Woche noch keine Aufrufe. Teil dein Profil, damit es mehr Leute sehen.',
    ],
];
