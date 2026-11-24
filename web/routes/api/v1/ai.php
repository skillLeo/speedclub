<?php

use App\Http\Controllers\Api\V1\Ai\AiController;
use App\Http\Middleware\EnsureFeatureEnabled;
use Illuminate\Support\Facades\Route;

// M3.7 [AI] features (m3.7 contract §1, 02_PRODUCT_SPEC §6). Members only (verified not required); each is 404 feature_disabled while
// its ai.* flag is off, and AiGateway also answers 404 while no provider is configured (OA-18). throttle:ai is 30 an hour per member,
// throttle:ai-translate 60. The moderation triage has no member endpoint (App\Jobs\Ai).
Route::middleware('member')->prefix('ai')->name('ai.')->group(function (): void {
    Route::post('search/interpret', [AiController::class, 'interpret'])
        ->middleware([EnsureFeatureEnabled::class.':ai.nl_search', 'throttle:ai'])->name('search.interpret');
    Route::post('mods/suggest', [AiController::class, 'suggestMod'])
        ->middleware([EnsureFeatureEnabled::class.':ai.mod_assist', 'throttle:ai'])->name('mods.suggest');
    Route::post('photos/{media}/category', [AiController::class, 'photoCategory'])
        ->middleware([EnsureFeatureEnabled::class.':ai.photo_tagging', 'throttle:ai'])->name('photos.category');
    Route::post('translate', [AiController::class, 'translate'])
        ->middleware([EnsureFeatureEnabled::class.':ai.translate', 'throttle:ai-translate'])->name('translate');
    Route::post('vehicles/{vehicle}/description', [AiController::class, 'description'])
        ->middleware([EnsureFeatureEnabled::class.':ai.description_assist', 'throttle:ai'])->name('vehicles.description');
    // M5.9 (m5.9-contract §2.1, §2.2): typical factory specs in the wizard (shared cache per generation); a typed part matched to the
    // catalogue (words first, AI only to normalise). Suggestions only: nothing is written, so no Idempotency-Key.
    Route::post('specs/suggest', [AiController::class, 'suggestSpecs'])
        ->middleware([EnsureFeatureEnabled::class.':ai.vehicle_specs', 'throttle:ai'])->name('specs.suggest');
    Route::post('products/match', [AiController::class, 'matchProduct'])
        ->middleware([EnsureFeatureEnabled::class.':ai.product_match', EnsureFeatureEnabled::class.':parts_catalogue', 'throttle:ai'])->name('products.match');
});
