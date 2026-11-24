<?php

// M5.5 Shop (10 §3, m5.5-contract). Server strings only; the app and the admin pages keep their own.
return [
    'all' => 'Alle',
    'buy_soon' => 'Bald im Shop erhältlich',
    'upload' => [
        'too_large' => 'Die Datei ist zu groß. Bitte lade höchstens :max MB hoch.',
        'too_small' => 'Das Bild ist zu klein. Für das 4:5-Produktfoto braucht es einen Ausschnitt von mindestens :width × :height Pixeln.',
        'banner_too_small' => 'Das Bild ist zu klein. Ein Banner braucht mindestens :width Pixel Breite.',
        'banner_ratio' => 'Das Banner braucht ein Format zwischen 4:5 (hoch) und 21:9 (breit).',
        'too_many' => 'Ein Produkt hat höchstens :max Fotos.',
        'last_image' => 'Ein sichtbares Produkt braucht mindestens ein Foto. Blende es zuerst aus.',
    ],
    'validation' => [
        'shopify_url' => 'Gib die Produktadresse aus deinem Shop ein (https://…/products/…). Erlaubt sind nur die eingetragenen Shop-Adressen.',
        'store_missing' => 'Trag zuerst die Shop-Adresse auf dem Server ein (OA-44).',
        'incomplete' => 'Zum Anzeigen fehlt noch: :missing.',
        'missing' => [
            'image' => 'ein Foto',
            'shopify_url' => 'die Produktadresse im Shop',
        ],
        'order' => 'Die Reihenfolge passt nicht mehr zur Liste. Lade die Seite neu.',
        'variant_id' => 'Eine Shopify-Varianten-ID besteht nur aus Ziffern.',
        'slug_taken' => 'Diese Adresse hat schon ein anderes Produkt.',
        'banner_product' => 'Wähle ein Produkt, auf das das Banner zeigt.',
        'banner_category' => 'Wähle eine Kategorie, auf die das Banner zeigt.',
        'banner_link_hidden' => 'Das Banner zeigt auf ein Produkt, das gerade nicht im Shop zu sehen ist.',
    ],
];
