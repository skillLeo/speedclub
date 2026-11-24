<?php

// R4-2.1 Car of the Day voting (contract-cotd-voting §2.2): the messages of the vote POST.
return [
    'vote' => [
        'closed' => 'Voting for this day is closed.',
        'not_open' => 'Voting for this day has not started yet.',
        'unavailable' => 'There is no vote for this day.',
        'not_ready' => 'Voting is just starting. Try again in a moment.',
        'not_candidate' => 'This car is not up for the vote on this day.',
        'own_car' => 'You cannot vote for your own car.',
        'too_new' => 'You can vote three days after signing up.',
        'sample_account' => 'A sample account cannot vote.',
    ],
];
