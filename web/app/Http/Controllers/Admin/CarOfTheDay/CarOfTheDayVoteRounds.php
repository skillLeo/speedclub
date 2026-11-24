<?php

namespace App\Http\Controllers\Admin\CarOfTheDay;

use App\Enums\CarOfTheDaySource;
use App\Http\Controllers\Admin\Support\MediaUrls;
use App\Models\CarOfTheDay;
use App\Models\Vehicle;
use App\Services\CarOfTheDay\CarOfTheDayVotes;
use App\Services\CarOfTheDay\CarOfTheDayVoting;
use App\Services\Garage\VehiclePresenter;
use Carbon\CarbonImmutable;
use Illuminate\Support\Collection;

/**
 * ADM-64 "Abstimmungen" (R4-2.1, contract-cotd-voting §4 / V6 / V8): staff only. Per round (newest first) the frozen candidates in the
 * Picker's order with all votes and the ones that count now (CarOfTheDayVotes::staffDays), and how the day was decided: still open,
 * closed and counting, by the votes, by the Picker (no counted vote), or by the team (a staff choice or skip wins over the votes).
 * Counts never leave the admin.
 *
 * R4DQ-34: `current` names the round that opened last (CarOfTheDayVoting::roundDay) and, when it has no vote, why (too few candidates,
 * a team decision, still being frozen), so staff are told the reason instead of "no round yet".
 */
final class CarOfTheDayVoteRounds
{
    public function __construct(
        private readonly CarOfTheDayVotes $votes,
        private readonly VehiclePresenter $presenter,
        private readonly CarOfTheDayVoting $voting,
    ) {}

    /**
     * @param  Collection<string, CarOfTheDay>  $rows  the day rows of the range, keyed by Y-m-d
     * @return array{enabled: bool, closes_at: string, current: array{day: string, unavailable: string|null}, rounds: list<array<string, mixed>>}
     */
    public function for(string $from, string $to, Collection $rows, CarbonImmutable $now): array
    {
        $tallies = $this->votes->staffDays($from, $to);
        $ids = collect($tallies)->flatten(1)->pluck('vehicle_id')->unique()->values()->all();
        $vehicles = Vehicle::withTrashed()->with(['make', 'vehicleModel', 'generation', 'cover', 'owner:id,username'])->whereKey($ids)->get()->keyBy('id');
        $closesAt = config()->string('speedclub.car_of_the_day.voting.closes_at');
        $zone = config()->string('speedclub.car_of_the_day.timezone');
        $rounds = [];

        foreach (array_reverse($tallies, true) as $day => $candidates) {
            /** @var CarOfTheDay|null $row */
            $row = $rows->get($day);
            $closes = CarbonImmutable::parse($day.' '.$closesAt, $zone);
            $status = match (true) {
                $row !== null && ($row->skipped || $row->source === CarOfTheDaySource::Staff) => 'staff',
                $row !== null && $row->by_vote => 'by_vote',
                $row !== null => 'picker',
                $now->lessThan($closes) => 'open',
                default => 'counting',
            };

            $rounds[] = [
                'day' => $day,
                'status' => $status,
                'closes_at' => $closes->toIso8601String(),
                'total' => array_sum(array_column($candidates, 'votes')),
                'candidates' => array_map(function (array $c) use ($vehicles, $row): array {
                    $vehicle = $vehicles->get($c['vehicle_id']);

                    return [
                        'position' => $c['position'],
                        'votes' => $c['votes'],
                        'counted' => $c['counted'],
                        'winner' => $row !== null && ! $row->skipped && $row->vehicle_id === $c['vehicle_id'],
                        'vehicle' => $vehicle instanceof Vehicle ? [
                            'id' => $vehicle->id,
                            'title' => $this->presenter->fullTitle($vehicle),
                            'cover' => MediaUrls::at($vehicle->cover, 64),
                            'cover_focus' => MediaUrls::focus($vehicle->cover),
                            'cover_placeholder' => MediaUrls::placeholder($vehicle->cover),
                            'owner' => $vehicle->owner === null ? null : ['id' => $vehicle->owner->id, 'username' => $vehicle->owner->username],
                            'deleted' => $vehicle->trashed(),
                        ] : null,
                    ];
                }, $candidates),
            ];
        }

        $current = CarOfTheDayVoting::roundDay($now);
        $enabled = $this->votes->enabled();

        // As a member's first read (V2): an open round is frozen now, so "too few candidates" is known rather than "not ready".
        if ($enabled && CarOfTheDayVoting::isOpen($current, $now)) {
            $this->voting->prepare($current);
        }

        return [
            'enabled' => $enabled,
            'closes_at' => $closesAt,
            'current' => ['day' => $current, 'unavailable' => $this->voting->unavailable($current)?->value],
            'rounds' => $rounds,
        ];
    }
}
