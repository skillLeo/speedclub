<?php

// Server-rendered strings of Home and Discover (HOME-01, DISC-01, DISC-02; 02_PRODUCT_SPEC §3.7, §3.8, §10).
return [
    'query_required' => 'Enter a search term, for example a make, a model or a username.',
    'query_too_long' => 'The search term is too long. Shorten it to :max characters or fewer.',
    'query_invalid' => 'The search term needs at least one letter or digit.',
    'garage_count' => '{0} No vehicles yet|{1} 1 vehicle|[2,*] :count vehicles',
    // M2.3 filters (DISC-02) and search/interpret.
    'filters' => [
        'unknown_make' => 'This make is not in the catalogue. Choose a make from the list.',
        'unknown_model' => 'This model does not exist for this make. Choose a model from the list.',
        'model_needs_make' => 'Several makes have a model of this name. Choose the make first.',
        'unknown_generation' => 'This generation does not exist for this model. Choose a generation from the list.',
        'generation_needs_model' => 'A generation can only be filtered together with a model. Choose the model first.',
        'unknown_brand' => 'This brand is not in the parts catalogue. Choose a brand from the list.',
        'unknown_value' => 'This filter has no such value. Choose a value from the list.',
        'list' => 'This filter takes a list, for example drivetrain[]=rear.',
        'wheel_diameter' => 'This wheel diameter does not exist. Choose a value from 13″ to 24″ in steps of 0.5″.',
        'range_order' => 'The maximum is below the minimum. Adjust one of the two values.',
    ],
    'interpret' => [
        'power_min' => 'from :power PS',
    ],
];
