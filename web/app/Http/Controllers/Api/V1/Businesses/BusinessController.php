<?php

namespace App\Http\Controllers\Api\V1\Businesses;

use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V1\Businesses\BusinessListRequest;
use App\Http\Requests\Api\V1\Businesses\BusinessPageRequest;
use App\Http\Resources\V1\BusinessCardResource;
use App\Http\Resources\V1\BusinessResource;
use App\Http\Resources\V1\FeedVehicleResource;
use App\Services\Businesses\BusinessListing;
use App\Services\Businesses\BusinessViews;
use App\Support\Viewer;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

/**
 * Business profiles (09 §8.10, BIZ-01, flag `businesses`). Guests too. Only verified businesses are listed or shown to anybody but
 * their team; anything else is 404 business_unavailable. No ratings and no reviews exist (09 §3.2).
 */
class BusinessController extends Controller
{
    use FindsBusinesses;

    /**
     * List businesses.
     *
     * Guests too. The Betriebe scope of Entdecken and Home "Werkstätten in deiner Nähe" (`lat`, `lng`, `radius_km`; each card carries
     * `distance_km`). Verified businesses, real ones before samples, by name; each card with `cover` (ADR-457 fallback chain); cursor
     * pages.
     *
     * @unauthenticated
     */
    public function index(BusinessListRequest $request, BusinessListing $listing): AnonymousResourceCollection
    {
        return BusinessCardResource::collection($listing->page(Viewer::from($request), $request->filters(), $request->pageSize()));
    }

    /**
     * Show a business.
     *
     * Guests too. BIZ-01 and the data of /b/{slug}: profile, opening hours, address, contact, the real portfolio count and the Impressum
     * (§ 5 DDG). Counts a private profile view for BIZ-03 (not the team's own). `cover` is the hero (DQ-1215, as on /b/{slug}): the
     * business's own cover, else a portfolio build's photo only when that build has a second photo for its card in the portfolio; else
     * null (the client shows its brand stage), so hero and portfolio card never show the same picture.
     *
     * @unauthenticated
     */
    public function show(Request $request, string $slug, BusinessListing $listing, BusinessViews $views): BusinessResource
    {
        $viewer = Viewer::from($request);
        $business = $this->findBusiness($slug, $viewer);
        $business->portfolioCount = $listing->portfolioCount($viewer, $business);
        $listing->prepareHero($business, $viewer);
        $views->record($business, $viewer, $request);

        return new BusinessResource($business);
    }

    /**
     * List a business's portfolio.
     *
     * Guests too. "Builds aus unserer Werkstatt": visible builds with a mod whose tag the business and the build's owner both confirmed,
     * real builds before samples, each last changed first; cursor pages.
     *
     * @unauthenticated
     */
    public function portfolio(BusinessPageRequest $request, string $slug, BusinessListing $listing): AnonymousResourceCollection
    {
        $viewer = Viewer::from($request);

        return FeedVehicleResource::collection($listing->portfolio($viewer, $this->findBusiness($slug, $viewer), $request->pageSize()));
    }
}
