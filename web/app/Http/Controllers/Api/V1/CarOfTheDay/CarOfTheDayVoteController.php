<?php

namespace App\Http\Controllers\Api\V1\CarOfTheDay;

use App\Actions\CarOfTheDay\CastCarOfTheDayVote;
use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V1\CarOfTheDay\CastCarOfTheDayVoteRequest;
use App\Http\Resources\V1\CarOfTheDay\CarOfTheDayVoteStateResource;
use App\Models\CarOfTheDayVote;
use App\Models\User;
use App\Services\CarOfTheDay\CarOfTheDayVoting;
use App\Support\QaClock;
use Carbon\CarbonImmutable;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;

/**
 * R4-2.1 Car of the Day voting (contract-cotd-voting §2), flag cotd_voting (404 feature_disabled while off). Members only.
 */
class CarOfTheDayVoteController extends Controller
{
    /**
     * Show the Car of the Day vote.
     *
     * The current round (tomorrow's Car of the Day from 18:00, today's until then) with its candidates in the Picker's order, whether and
     * for which car the reader voted, and the last decided round. Never a vote count.
     */
    public function show(Request $request, CarOfTheDayVoting $voting): CarOfTheDayVoteStateResource
    {
        /** @var User $user */
        $user = $request->user();
        Gate::authorize('viewAny', CarOfTheDayVote::class);
        $frozen = QaClock::frozen($request);

        return new CarOfTheDayVoteStateResource($voting->state($user, $frozen ?? CarbonImmutable::now(), freeze: $frozen === null));
    }

    /**
     * Cast or change the Car of the Day vote.
     *
     * One vote per account and round, changeable until the round closes (17:00 Europe/Berlin). Answers the same body as the GET.
     */
    public function store(CastCarOfTheDayVoteRequest $request, CastCarOfTheDayVote $action, CarOfTheDayVoting $voting): CarOfTheDayVoteStateResource
    {
        /** @var User $user */
        $user = $request->user();
        Gate::authorize('create', CarOfTheDayVote::class);

        $action->handle($user, $request->day(), $request->vehicleId());

        return new CarOfTheDayVoteStateResource($voting->state($user, CarbonImmutable::now(), freeze: true));
    }
}
