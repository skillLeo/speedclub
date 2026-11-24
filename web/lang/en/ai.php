<?php

// M3.7 [AI] features (02_PRODUCT_SPEC §6). Labels per EU AI Act Art. 50: people see that a text or value comes from an AI.
return [
    'label' => [
        'suggestion' => 'AI suggestion',
        'translated' => 'Translated',
        // M5.9: the source of power and torque taken over from "Daten übernehmen?", and the forum's 3-line summary.
        'factory_suggestion' => 'Manufacturer figure (AI suggestion)',
        'summary' => 'AI summary',
    ],
    'unknown_category' => 'This category does not exist.',
    'photo_not_ready' => 'The photo is still being processed. Try again in a moment.',
    'nothing_to_translate' => 'There is no text to translate here.',
    'too_long_to_translate' => 'This text is too long to translate.',
    // M5.9.
    'unknown_vehicle' => 'This generation does not exist or is no longer active.',
    'suggestion_expired' => 'This suggestion has expired. Load the figures again.',
];
