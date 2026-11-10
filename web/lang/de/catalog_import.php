<?php

// M3.3 ADM-17: why a CSV file as a whole cannot be read (App\Services\Catalog\CatalogCsv, CatalogImportPlanner). Errors of single rows
// are codes the admin page translates (lang/admin/<locale>/catalog.json).
return [
    'file' => [
        'too_large' => 'Die Datei ist größer als :max_mb MB.',
        'empty' => 'Die Datei ist leer.',
        'unreadable' => 'Die Datei lässt sich nicht lesen.',
        'too_many_rows' => 'Die Datei hat mehr als :max_rows Zeilen. Teile sie bitte auf.',
        'unknown_column' => 'Die Spalte „:column“ kennen wir nicht. Nutze die Vorlage.',
        'repeated_column' => 'Die Spalte „:column“ kommt doppelt vor.',
        'missing_column' => 'Die Spalte „:column“ fehlt.',
    ],
];
