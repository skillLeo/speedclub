<?php

// M4.12 meets (09 §8.7): messages of the event endpoints. The app writes its own screens; these reach it as field errors and 409s.
return [
    'ends_before_start' => 'The end must be after the start.',
    'too_long' => 'A meet lasts at most :hours hours.',
    'starts_in_past' => 'The start must be in the future.',
    'required_to_submit' => 'We need this before you send the meet.',
    'legal_only_required' => 'Confirm that your meet is legal: no racing and no dangerous driving on public roads.',
    'rules_required' => 'Accept the rules for meets to continue.',
    'location_visibility_locked' => 'Who sees the place cannot be changed after sending.',
    'cancel_first' => 'Cancel the meet first so everybody who is going hears about it. Then you can delete it.',
    'open_limit' => 'You already have :max open meets. Delete a draft or wait until a meet is over.',
    'cannot_answer_own' => 'At your own meet you are there as the organiser.',
    'organiser_left' => 'The organiser closed their account.',
];
