<?php

// M3.5 Brand, content, configuration: validation and server texts of the admin Actions (ADM-28…38) and the member re-consent.
return [
    'upload' => [
        'type' => 'Please upload a JPEG, PNG or WebP image.',
        'unreadable' => 'The image cannot be read. Please upload it again.',
        'too_many_pixels' => 'The image is too large. Please upload it with at most 12 megapixels.',
        'too_small' => 'The image is too small. It needs at least :width × :height pixels.',
    ],
    'brand' => [
        'accent' => 'Choose one of the checked accent colours.',
        'asset_kind' => 'This image does not fit this slot.',
        'focal' => 'The focal point must lie inside the image.',
        'hero_contrast' => 'The logo or text would be hard to read on this photo (contrast :ratio:1, needed :minimum:1). Choose another focal point or a darker photo.',
    ],
    'home' => [
        'ends_before_start' => 'The end must be after the start.',
        'filters' => 'These filters do not make a valid search.',
        'vehicles' => 'Choose at least one vehicle.',
        'vehicle_missing' => 'This vehicle is not publicly visible.',
        'too_many_live' => 'At most :max builds may be featured at the same time (here :count).',
    ],
    'announcements' => [
        'ends_before_start' => 'The end must be after the start.',
        'cta_label' => 'The button needs a label.',
    ],
    'remote' => [
        'min_above_latest' => 'The minimum version must not be above the latest version.',
        'maintenance_message' => 'Maintenance mode needs a message.',
    ],
    'rate_limits' => [
        'unknown' => 'Unknown limits: :names.',
    ],
    'org' => [
        'field' => 'This value is not allowed.',
        'size' => 'The details are too long.',
    ],
    'flags' => [
        'empty' => 'There is no change.',
    ],
    'approvals' => [
        'changed' => 'The change was edited or discarded since the request.',
    ],
    'templates' => [
        'unknown_variables' => 'These placeholders do not exist here: :names.',
        'plural_forms' => 'Keep the number of variants (separated by |).',
        'test_subject' => '[Test] :subject',
        'test_heading' => 'Test send: :key',
    ],
    'consent' => [
        'outdated' => 'This version is no longer current. Please load the new version.',
    ],
];
