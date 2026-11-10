<?php

use Illuminate\Support\Facades\Route;

// One file per domain in routes/api/v1 (05_ARCHITECTURE §5). Prefix "api" comes from bootstrap/app.php.
Route::prefix('v1')->name('api.v1.')->group(function (): void {
    foreach (glob(__DIR__.'/api/v1/*.php') ?: [] as $file) {
        require $file;
    }
});
