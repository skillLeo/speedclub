<?php

// M3.3 ADM-17: why a CSV file as a whole cannot be read (App\Services\Catalog\CatalogCsv, CatalogImportPlanner). Errors of single rows
// are codes the admin page translates (lang/admin/<locale>/catalog.json).
return [
    'file' => [
        'too_large' => 'The file is larger than :max_mb MB.',
        'empty' => 'The file is empty.',
        'unreadable' => 'The file cannot be read.',
        'too_many_rows' => 'The file has more than :max_rows rows. Please split it.',
        'unknown_column' => 'We do not know the column “:column”. Please use the template.',
        'repeated_column' => 'The column “:column” appears twice.',
        'missing_column' => 'The column “:column” is missing.',
    ],
];
