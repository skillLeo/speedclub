<?php

namespace App\Http\Controllers\Api\V1\Dex;

use App\Actions\Dex\RecordSpot;
use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V1\Dex\StoreSpotRequest;
use App\Http\Resources\V1\SpotResultResource;
use App\Models\Spot;
use App\Models\User;
use App\Services\Dex\SpotCards;
use App\Services\Dex\SpotOutcome;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;

/**
 * STREET DEX spots (10 §16.2, m5.9b contract §2, §3): DEX-02 writes them, DEX-03 reveals them.
 */
class SpotController extends Controller
{
    /**
     * Spot a car.
     *
     * The in-app scanner only. Accepts an Idempotency-Key header; 30 per member and hour (429). Body: `code` and, when the device found
     * one, `city_id` (preferred; its Bundesland wins) or `city` + `bundesland`; any other field, coordinates above all, is refused (422).
     * 201 with the card for a new spot; 200 with the existing card for the same car again within 24 h (`meta.duplicate`). An account
     * younger than 24 h gets 201 with `meta.counted` false and `meta.reason` "account_too_new"; a real member's scan of a sample car the
     * same with "sample_car" (samples never earn). 404 `qr_not_found` for an unknown code;
     * 409 `spot_unavailable` (revoked code, a car one cannot see, a block either way), `spot_own_car`, `spotting_paused`.
     */
    public function store(StoreSpotRequest $request, RecordSpot $action, SpotCards $cards): SpotResultResource
    {
        Gate::authorize('create', Spot::class);

        /** @var User $user */
        $user = $request->user();
        /** @var array{code: string, city_id?: int|null, city?: string|null, bundesland?: string|null} $input */
        $input = $request->validated();
        $outcome = $action->handle($user, $input);

        /** @status 201 */
        return new SpotResultResource($outcome, $cards->forSpot($user, $outcome->spot), ! $outcome->duplicate);
    }

    /**
     * Read one of my spots.
     *
     * The reveal (DEX-03) after a restart or from a link. The spotter only: anybody else, and a spot of a car the spotter may no longer
     * see, gets 404. `meta.new_in_dex` says whether this spot put the car into the Dex.
     */
    public function show(Request $request, Spot $spot, SpotCards $cards): SpotResultResource
    {
        /** @var User $user */
        $user = $request->user();

        abort_unless(Gate::allows('view', $spot) && Gate::allows('view', $spot->vehicle), 404);

        $first = $spot->counted ? $cards->firstSpotOf($user, $spot->vehicle) : null;
        $reason = $spot->counted ? null : (RecordSpot::sampleCar($spot->vehicle, $user) ? 'sample_car' : 'account_too_new');
        $outcome = new SpotOutcome($spot, $first?->id === $spot->id, false, $spot->is_first_three, [], $reason);

        return new SpotResultResource($outcome, $cards->forSpot($user, $spot));
    }
}
