<?php

namespace App\Http\Controllers\Web;

use App\Http\Controllers\Controller;
use App\Models\Brand;
use App\Services\AppConfig\FeatureFlags;
use App\Services\Parts\BrandPages;
use App\Services\PublicPages\PartnerPages;
use App\Support\Viewer;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * WEB-11 /brands/{slug} (09 §9, M4.14): a part brand's page (BRD-01 on the web), behind the flag `parts_catalogue`. A brand without a
 * page and the flag off answer the 404 page; a merged brand's old slug answers 301 to its survivor.
 */
class PublicBrandController extends Controller
{
    public function __invoke(Request $request, string $slug, FeatureFlags $flags, BrandPages $brands, PartnerPages $pages): Response
    {
        $brand = $flags->enabled('parts_catalogue') ? $brands->find(mb_strtolower($slug)) : null;

        if (! $brand instanceof Brand) {
            return response()->view('public.state', ['state' => 'brand_unavailable'], 404);
        }

        if ($brand->slug !== $slug) {
            $query = $request->getQueryString();

            return redirect('/brands/'.$brand->slug.($query === null ? '' : '?'.$query), 301);
        }

        return response()->view('public.brand', $pages->brand($brand, Viewer::from($request), $request));
    }
}
