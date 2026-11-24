<?php

// M5.9d badge rules (App\Services\Badges\BadgeRules) and the Car of the Day story line; messages of the admin badge manager and the API.
return [
    'rule' => [
        'shape' => 'Die Regel muss ein Objekt mit „metric“ sein.',
        'metric' => 'Diese Kennzahl gibt es nicht.',
        'keys' => 'Die Regel enthält Felder, die es für diese Kennzahl nicht gibt.',
        'eq' => 'Diese Kennzahl ist ja oder nein: Setz „eq“ auf true.',
        'gte' => 'Der Wert („gte“) muss eine ganze Zahl von 1 bis 1.000.000 sein.',
        'set' => 'Diese Sammlung gibt es nicht.',
        'retired' => 'Die Regel dieses Abzeichens nennt eine Kennzahl oder ein Set, das es nicht mehr gibt. Bau erst eine neue Regel.',
    ],
    'hidden_name' => '???',
];
