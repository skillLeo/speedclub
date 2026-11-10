<?php

namespace App\Http\Controllers\Admin\Catalog\Support;

use App\Services\Catalog\CatalogRefused;
use Closure;
use Illuminate\Http\RedirectResponse;

/**
 * Runs a catalogue write and turns a CatalogRefused (m3.3 §1: referenced, field has data, slug taken …) into a 303 back with the
 * sentence as a field error, the way a validation error comes back to an Inertia form.
 */
final class Refusals
{
    /**
     * @param  Closure(): RedirectResponse  $write
     */
    public static function answer(Closure $write): RedirectResponse
    {
        try {
            return $write();
        } catch (CatalogRefused $refused) {
            return back(303)->withErrors([CatalogText::field($refused) => CatalogText::refusal($refused)]);
        }
    }
}
