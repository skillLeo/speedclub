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
        'wrapped_release' => 'Each release needs a season key (for example 2027-saison or 2027-jahr) and a date with time and time zone.',
        'wrapped_release_soon' => 'A new release must be at least one day ahead (:date at the earliest), so every Wrapped is ready in time.',
        'wrapped_release_season' => 'The release must come after the end of the season (after :date), or its last weeks are missing.',
    ],
    'rate_limits' => [
        'unknown' => 'Unknown limits: :names.',
    ],
    'governance' => [
        'field' => 'This setting does not exist.',
    ],
    'org' => [
        'field' => 'This value is not allowed.',
        'size' => 'The details are too long.',
        // Client round 6: the save dialog names the field of a refused value (OrgSchema), and a refused save says so.
        'owner_only' => 'Only an Owner can save the company data. Nothing was saved.',
        'vat_id' => 'VAT ID: it starts with two letters and contains figures, e.g. DE 123 456 789.',
        'phone' => 'Phone: only figures, spaces, +, /, - and brackets, e.g. +49 (0) 30 1234567.',
        'fields' => [
            'company_name' => 'Company name',
            'legal_form' => 'Legal form',
            'street' => 'Street and number',
            'postal_city' => 'Postcode and city',
            'representative' => 'Authorised representative',
            'responsible_person' => 'Person responsible',
            'contact_email' => 'Contact e-mail',
            'phone' => 'Phone',
            'support_email' => 'Support e-mail',
            'privacy_email' => 'Privacy e-mail',
            'dsa_email' => 'DSA contact e-mail',
            'report_email' => 'Report e-mail',
            'register_court' => 'Register court',
            'register_number' => 'Register number',
            'vat_id' => 'VAT ID',
            'supervisory_authority' => 'Supervisory authority',
            'default_locale' => 'Default language',
        ],
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
