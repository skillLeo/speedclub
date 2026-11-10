<?php

// Server-rendered strings of Start and Entdecken (HOME-01, DISC-01, DISC-02; 02_PRODUCT_SPEC §3.7, §3.8, §10).
return [
    'query_required' => 'Gib einen Suchbegriff ein, zum Beispiel eine Marke, ein Modell oder einen Benutzernamen.',
    'query_too_long' => 'Der Suchbegriff ist zu lang. Kürze ihn auf höchstens :max Zeichen.',
    'query_invalid' => 'Der Suchbegriff braucht mindestens einen Buchstaben oder eine Ziffer.',
    'garage_count' => '{0} Noch keine Fahrzeuge|{1} 1 Fahrzeug|[2,*] :count Fahrzeuge',
    // M2.3 filters (DISC-02) and search/interpret.
    'filters' => [
        'unknown_make' => 'Diese Marke gibt es im Katalog nicht. Wähle eine Marke aus der Liste.',
        'unknown_model' => 'Dieses Modell gibt es bei dieser Marke nicht. Wähle ein Modell aus der Liste.',
        'model_needs_make' => 'Diesen Modellnamen gibt es bei mehreren Marken. Wähle zuerst die Marke.',
        'unknown_generation' => 'Diese Generation gibt es bei diesem Modell nicht. Wähle eine Generation aus der Liste.',
        'generation_needs_model' => 'Eine Generation lässt sich nur mit Modell filtern. Wähle zuerst das Modell.',
        'unknown_brand' => 'Diese Marke gibt es im Teilekatalog nicht. Wähle eine Marke aus der Liste.',
        'unknown_value' => 'Diesen Wert gibt es für diesen Filter nicht. Wähle einen Wert aus der Liste.',
        'list' => 'Dieser Filter braucht eine Liste, zum Beispiel drivetrain[]=rear.',
        'wheel_diameter' => 'Diesen Felgendurchmesser gibt es nicht. Wähle einen Wert von 13″ bis 24″ in Schritten von 0,5″.',
        'range_order' => 'Der Höchstwert liegt unter dem Mindestwert. Passe einen der beiden Werte an.',
    ],
    'interpret' => [
        'power_min' => 'ab :power PS',
    ],
];
