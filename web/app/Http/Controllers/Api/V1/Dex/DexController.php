<?php

namespace App\Http\Controllers\Api\V1\Dex;

use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V1\Dex\DexListRequest;
use App\Http\Resources\V1\DexSetResource;
use App\Http\Resources\V1\SpotCardResource;
use App\Models\Spot;
use App\Models\User;
use App\Services\Dex\DexQuery;
use App\Services\Dex\DexSets;
use App\Services\Dex\SpotCards;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Facades\Gate;

/**
 * DEX-01 "Mein Dex" and DEX-05 sets (m5.9b contract §3).
 */
class DexController extends Controller
{
    /**
     * My Dex.
     *
     * One card per car I found (my first counted spot of it), newest find first; cursor pages. `filter`: all, rarity:{tier},
     * make:{slug} or set:{key}. `meta.found` / `meta.total` for "Dex 87 / 1.240": cars found (any filter aside) and every car there is
     * to find (public cars, real ones only, plus the ghost cars I found). A car leaves the list while I may not see it.
     */
    public function index(DexListRequest $request, DexQuery $dex, SpotCards $cards): AnonymousResourceCollection
    {
        Gate::authorize('viewAny', Spot::class);

        /** @var User $user */
        $user = $request->user();
        $page = $dex->page($user, $request->dexFilter(), $request->pageSize());
        $ids = array_values($page->getCollection()->map(fn (object $row): string => (string) get_object_vars($row)['spot_id'])->all());
        $page->setCollection(collect($cards->forSpots($user, $ids)));

        /** @var array{found: int, total: int} $counts */
        $counts = $dex->counts($user);

        return SpotCardResource::collection($page)->additional(['meta' => $counts]);
    }

    /**
     * My sets.
     *
     * JDM, city and season sets always, a brand set once I found a car of its make. Each with its slots: a found slot carries the full
     * SpotCard; an unfound JDM slot names make and generation ("???"), other unfound slots are blank.
     */
    public function sets(Request $request, DexSets $sets): AnonymousResourceCollection
    {
        Gate::authorize('viewAny', Spot::class);

        /** @var User $user */
        $user = $request->user();

        return DexSetResource::collection($sets->forUser($user));
    }
}
