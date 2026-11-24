<?php

namespace App\Http\Resources\V1\CarOfTheDay;

use App\Enums\CarOfTheDayRoundStatus;
use App\Enums\CarOfTheDayRoundUnavailable;
use App\Enums\CarOfTheDayVoteBlock;
use App\Http\Resources\V1\FeedVehicleResource;
use App\Models\Vehicle;
use Carbon\CarbonImmutable;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * R4-2.1 (contract-cotd-voting §2.1): the reader's round and the last decided one. Never a vote count, share or order by votes (V7).
 *
 * @property array{round: array{day: string, status: CarOfTheDayRoundStatus, unavailable_reason: CarOfTheDayRoundUnavailable|null, opens_at: CarbonImmutable, closes_at: CarbonImmutable, can_vote: bool, cannot_vote_reason: CarOfTheDayVoteBlock|null, can_vote_from: CarbonImmutable|null, my_vote: string|null, candidates: list<array{position: int, own: bool, votable: bool, vehicle: Vehicle}>}, last_result: array{day: string, my_vote: string|null, winner: Vehicle|null, by_vote: bool}|null} $resource
 */
class CarOfTheDayVoteStateResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $round = $this->resource['round'];
        $last = $this->resource['last_result'];
        // Every time with its Europe/Berlin offset, as the contract shows (2026-11-22T17:00:00+01:00).
        $tz = config()->string('speedclub.car_of_the_day.timezone');

        return [
            'round' => [
                /** The day the winner is Car of the Day (Y-m-d, Europe/Berlin). */
                'day' => $round['day'],
                'status' => $round['status'],
                'unavailable_reason' => $round['unavailable_reason'],
                'opens_at' => $round['opens_at']->setTimezone($tz)->toIso8601String(),
                'closes_at' => $round['closes_at']->setTimezone($tz)->toIso8601String(),
                'can_vote' => $round['can_vote'],
                'cannot_vote_reason' => $round['cannot_vote_reason'],
                /** @var string|null With account_too_new: when the account may vote. */
                'can_vote_from' => $round['can_vote_from']?->setTimezone($tz)->toIso8601String(),
                /** @var string|null The reader's vote (a vehicle id). */
                'my_vote' => $round['my_vote'],
                /** In the Picker's order (position 1…3), never by votes. */
                'candidates' => array_map(fn (array $candidate): array => [
                    'position' => $candidate['position'],
                    'own' => $candidate['own'],
                    'votable' => $candidate['votable'],
                    'vehicle' => new FeedVehicleResource($candidate['vehicle']),
                ], $round['candidates']),
            ],
            /** @var array{day: string, my_vote: string|null, winner: FeedVehicleResource|null, by_vote: bool}|null */
            'last_result' => $last === null ? null : [
                'day' => $last['day'],
                'my_vote' => $last['my_vote'],
                'winner' => $last['winner'] === null ? null : new FeedVehicleResource($last['winner']),
                'by_vote' => $last['by_vote'],
            ],
        ];
    }
}
