<?php

// R4-2.1 Car of the Day voting (contract-cotd-voting §2.2): the messages of the vote POST.
return [
    'vote' => [
        'closed' => 'Die Abstimmung für diesen Tag ist geschlossen.',
        'not_open' => 'Die Abstimmung für diesen Tag hat noch nicht begonnen.',
        'unavailable' => 'Für diesen Tag gibt es keine Abstimmung.',
        'not_ready' => 'Die Abstimmung startet gerade. Versuch es in einem Moment noch einmal.',
        'not_candidate' => 'Dieses Auto steht für diesen Tag nicht zur Wahl.',
        'own_car' => 'Für dein eigenes Auto kannst du nicht abstimmen.',
        'too_new' => 'Abstimmen kannst du drei Tage nach deiner Anmeldung.',
        'sample_account' => 'Mit einem Beispielkonto kannst du nicht abstimmen.',
    ],
];
