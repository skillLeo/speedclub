<?php

// M5.8 Forum (10 §7, m5.8-contract): validation messages of the member API. The app writes its own screens.
return [
    'category_unknown' => 'This category does not exist (any more). Pick another one.',
    'merge_invalid' => 'You can only merge into another, published topic.',
    'reply_elsewhere' => 'You cannot reply to this post here.',
    'attachments' => [
        'vehicle' => 'You can only attach one of your own cars.',
        'modification' => 'You can only attach a mod of the attached car.',
        'product' => 'This product is not (or no longer) in the catalogue.',
    ],
    'photos' => [
        'limit' => 'A topic has at most :max photos.',
    ],
    'solution' => [
        'invalid' => 'You can only mark a visible reply in this topic as the solution.',
    ],
];
