<?php

namespace App\Http\Controllers\Web;

use App\Http\Controllers\Controller;
use App\Models\Business;
use App\Services\AppConfig\FeatureFlags;
use App\Services\Businesses\BusinessViews;
use App\Services\PublicPages\PartnerPages;
use App\Support\SignedInBrowser;
use App\Support\Viewer;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;
use Symfony\Component\HttpFoundation\Response;

/**
 * WEB-10 /b/{slug} (09 §9, M4.14): the business page with its Impressum block, behind the flag `businesses`. A business the reader may
 * not see (not verified, removed, sample while hidden, a block with the owner), a missing one and the flag off answer the same 404 page.
 */
class PublicBusinessController extends Controller
{
    public function __invoke(Request $request, string $slug, FeatureFlags $flags, PartnerPages $pages, BusinessViews $views): Response
    {
        $viewer = Viewer::from($request);
        $business = $flags->enabled('businesses') ? Business::query()->with('owner')->where('slug', mb_strtolower($slug))->first() : null;

        if (! $business instanceof Business || ! Gate::forUser($viewer)->allows('view', $business) || SignedInBrowser::hasBlockWith($request, $business->owner)) {
            return response()->view('public.state', ['state' => 'business_unavailable'], 404);
        }

        if ($business->slug !== $slug) {
            $query = $request->getQueryString();

            return redirect('/b/'.$business->slug.($query === null ? '' : '?'.$query), 301);
        }

        $views->record($business, $viewer);

        return response()->view('public.business', $pages->business($business, $viewer, $request));
    }
}
