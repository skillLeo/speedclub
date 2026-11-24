<?php

// M5.9d badge rules (App\Services\Badges\BadgeRules) and the Car of the Day story line; messages of the admin badge manager and the API.
return [
    'rule' => [
        'shape' => 'The rule must be an object with “metric”.',
        'metric' => 'This metric does not exist.',
        'keys' => 'The rule has fields this metric does not take.',
        'eq' => 'This metric is yes or no: set “eq” to true.',
        'gte' => 'The value (“gte”) must be a whole number from 1 to 1,000,000.',
        'set' => 'This set does not exist.',
        'retired' => 'This badge’s rule names a metric or set that no longer exists. Build a new rule first.',
    ],
    'hidden_name' => '???',
];
