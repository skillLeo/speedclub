<?php

// M2.7 signature features (02_PRODUCT_SPEC §5): compare, share cards, the car-show placard.
return [
    'compare' => [
        'same_build' => 'Choose a different build to compare with.',
    ],
    'share_card' => [
        'photo' => "Choose one of this build's photos.",
        'text_characters' => 'Only letters, digits and punctuation, no emojis.',
        'text_length' => 'At most :max characters.',
        'mods' => '{1} :count mod|[2,*] :count mods',
    ],
    'placard' => [
        'title' => 'Build sheet',
        'specs' => 'Specs',
        'mods' => 'Modifications',
        'more_mods' => '{1} and one more modification|[2,*] and :count more modifications',
        'no_mods' => 'No modifications added yet.',
        'scan' => 'Scan for all photos, parts and the build history',
        'code' => 'Code :code',
        'owner' => 'Build by @:name',
        'disclaimer' => 'Stated by the owner, no legal review.',
    ],
];
