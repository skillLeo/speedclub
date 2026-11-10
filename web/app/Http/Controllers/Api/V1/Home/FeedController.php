<?php

namespace App\Http\Controllers\Api\V1\Home;

use App\Enums\FeedTab;
use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V1\Home\FeedRequest;
use App\Http\Resources\V1\FeedPageResource;
use App\Models\User;
use App\Models\VehicleSearch;
use App\Services\Home\HomeStream;
use App\Support\Viewer;
use Illuminate\Support\Facades\Gate;

/**
 * HOME-01 below the FS-2 modules (M2.2, 02_PRODUCT_SPEC §3.8).
 */
class FeedController extends Controller
{
    public function __construct(private readonly HomeStream $stream) {}

    /**
     * The Home stream.
     *
     * `for_you` (guests too): public builds by score (recency, completeness, cover quality, saves and new followers, the editorial
     * list), at most two items of one owner in a row, one update row after every three cards; what the page above shows is left out.
     * `following` (members; a guest gets 401): first publishes and build updates of followed members, newest first; an empty first page
     * carries `meta.suggestions`.
     *
     * @unauthenticated
     */
    public function __invoke(FeedRequest $request): FeedPageResource
    {
        $viewer = Viewer::from($request);
        Gate::forUser($viewer)->authorize('viewAny', VehicleSearch::class);

        if ($request->tab() === FeedTab::Following) {
            /** @var User $viewer FeedRequest refused a guest */
            return new FeedPageResource($this->stream->following($viewer, $request->pageSize()));
        }

        return new FeedPageResource($this->stream->forYou($viewer, $request->streamState(), $request->pageSize()));
    }
}
