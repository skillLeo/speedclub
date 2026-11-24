<?php

// M5.5 Shop (10 §3, m5.5-contract). Server strings only; the app and the admin pages keep their own.
return [
    'all' => 'All',
    'buy_soon' => 'Coming soon to the shop',
    'upload' => [
        'too_large' => 'The file is too large. Please upload at most :max MB.',
        'too_small' => 'The image is too small. The 4:5 product photo needs a crop of at least :width × :height pixels.',
        'banner_too_small' => 'The image is too small. A banner needs at least :width pixels in width.',
        'banner_ratio' => 'A banner needs a format between 4:5 (portrait) and 21:9 (wide).',
        'too_many' => 'A product has at most :max photos.',
        'last_image' => 'A visible product needs at least one photo. Hide it first.',
    ],
    'validation' => [
        'shopify_url' => 'Enter the product address from your shop (https://…/products/…). Only the configured shop addresses are allowed.',
        'store_missing' => 'Enter the shop address on the server first (OA-44).',
        'incomplete' => 'To show it, this is still missing: :missing.',
        'missing' => [
            'image' => 'a photo',
            'shopify_url' => 'the product address in the shop',
        ],
        'order' => 'The order no longer matches the list. Reload the page.',
        'variant_id' => 'A Shopify variant ID consists of digits only.',
        'slug_taken' => 'Another product already uses this address.',
        'banner_product' => 'Choose the product the banner points to.',
        'banner_category' => 'Choose the category the banner points to.',
        'banner_link_hidden' => 'The banner points to a product that is not visible in the shop right now.',
    ],
];
