<?php

namespace App\Http\Controllers\Admin\Catalog;

use App\Http\Controllers\Admin\Support\TableProps;
use App\Http\Controllers\Controller;
use App\Models\Staff;
use App\Services\Catalog\BrandNormaliser;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

/**
 * ADM-16 part brands (m3.3-contract §2, catalog.view): name, slug, category hint, aliases, usage (modifications, deleted ones included)
 * and the brand a merged one went into; the "Normalisieren" suggestions (BrandNormaliser: equal after folding case, diacritics and
 * punctuation, the more exact spelling first). Writes go through EntriesController with level `brand`.
 */
class BrandsController extends Controller
{
    public function index(Request $request, BrandNormaliser $normaliser): Response
    {
        /** @var Staff $staff */
        $staff = $request->user('staff');

        return Inertia::render('Catalog/Brands', [
            ...TableProps::make(CatalogListQuery::brands($request), $request, CatalogListQuery::BRANDS, $staff, fn (array $brands): array => CatalogListQuery::brandRows($brands), CatalogListQuery::BRANDS_SORT),
            'categories' => fn (): array => array_map(fn (string $key, string $name): array => ['value' => $key, 'label' => $name], array_keys(CatalogListQuery::categoryNames()), CatalogListQuery::categoryNames()),
            'suggestions' => fn (): array => $normaliser->suggestions(),
        ]);
    }
}
