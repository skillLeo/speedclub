<?php

namespace App\Http\Controllers\Admin\CarOfTheDay;

use App\Http\Controllers\Admin\Support\ActivityFeed;
use App\Http\Controllers\Admin\Support\MediaUrls;
use App\Http\Controllers\Controller;
use App\Models\CarOfTheDay;
use App\Models\Staff;
use App\Models\Vehicle;
use App\Services\CarOfTheDay\CarOfTheDayClock;
use App\Services\Garage\VehiclePresenter;
use Carbon\CarbonImmutable;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

/**
 * ADM-64 Car of the Day (M5.9d admin, m5.9d contract §3, ADR-510/513) under Marke & Inhalte: today and the next 14 days, then the last
 * 14, one row per Berlin day (car, owner, Bundesland, automatic or team choice and by whom, skipped with its reason, story line, live or
 * not). content.view reads; "Anderes Auto festlegen" and "Tag aussetzen" (the day Home shows, or later) need content.edit like the rest of the Home
 * curation (06 §3 Brand & content). A day without a row is still open: the 17:55 job picks it. R4-2.1: the vote rounds of the range
 * (CarOfTheDayVoteRounds) with their counts; a team choice or skip still wins over the votes.
 */
class CarOfTheDayIndexController extends Controller
{
    public const DAYS = 14;

    public function __invoke(Request $request, VehiclePresenter $presenter, CarOfTheDayVoteRounds $votes): Response
    {
        /** @var Staff $staff */
        $staff = $request->user('staff');
        $now = CarOfTheDayClock::now();
        $today = CarbonImmutable::parse(CarOfTheDayClock::today($now), config()->string('speedclub.car_of_the_day.timezone'));
        $from = $today->subDays(self::DAYS)->toDateString();
        $to = $today->addDays(self::DAYS)->toDateString();

        $rows = CarOfTheDay::query()->whereBetween('day', [$from, $to])->get()->keyBy(fn (CarOfTheDay $row): string => $row->dayString());
        $vehicles = Vehicle::withTrashed()->with(['make', 'vehicleModel', 'generation', 'cover', 'owner:id,username'])
            ->whereKey($rows->pluck('vehicle_id')->filter()->unique()->values()->all())->get()->keyBy('id');
        $deciders = Staff::query()->whereIn('id', $rows->pluck('decided_by')->filter()->unique()->values()->all())->pluck('name', 'id');

        // CR-P5G-03: before 18:00 Home still shows yesterday's pick, which staff may replace or skip as well.
        $shown = CarOfTheDayClock::shownDay($now);
        $day = function (CarbonImmutable $date) use ($rows, $vehicles, $deciders, $presenter, $today, $shown): array {
            $key = $date->toDateString();
            /** @var CarOfTheDay|null $row */
            $row = $rows->get($key);
            $vehicle = $row?->vehicle_id === null ? null : $vehicles->get($row->vehicle_id);

            return [
                'day' => $key,
                'today' => $key === $today->toDateString(),
                'editable' => $key >= $shown,
                'id' => $row?->id,
                'source' => $row?->source->value,
                'skipped' => $row->skipped ?? false,
                'skipped_reason' => $row?->skipped_reason,
                'story_line' => $row?->story_line,
                'bundesland' => $row?->bundesland === null ? null : (string) __('build_score.bundesland.'.$row->bundesland->value),
                'is_sample' => $row->is_sample ?? false,
                'published_at' => $row?->published_at?->toIso8601String(),
                'decided_by' => $row?->decided_by === null ? null : ($deciders[$row->decided_by] ?? null),
                'by_vote' => $row->by_vote ?? false,
                'vehicle' => $vehicle instanceof Vehicle ? [
                    'id' => $vehicle->id,
                    'title' => $presenter->fullTitle($vehicle),
                    'cover' => MediaUrls::at($vehicle->cover, 64),
                    'cover_focus' => MediaUrls::focus($vehicle->cover),
                    'cover_placeholder' => MediaUrls::placeholder($vehicle->cover),
                    'owner' => $vehicle->owner === null ? null : ['id' => $vehicle->owner->id, 'username' => $vehicle->owner->username],
                ] : null,
            ];
        };

        $upcoming = [];
        for ($i = 0; $i <= self::DAYS; $i++) {
            $upcoming[] = $day($today->addDays($i));
        }
        $past = [];
        for ($i = 1; $i <= self::DAYS; $i++) {
            $past[] = $day($today->subDays($i));
        }

        return Inertia::render('CarOfTheDay/Index', [
            'upcoming' => $upcoming,
            'past' => $past,
            'times' => ['pick_at' => config()->string('speedclub.car_of_the_day.pick_at'), 'publish_at' => config()->string('speedclub.car_of_the_day.publish_at')],
            'canEdit' => $staff->can('content.edit'),
            // R4-2.1: the vote rounds of the same range with their counts (staff only, contract-cotd-voting §4).
            'votes' => fn (): array => $votes->for($from, $to, $rows, $now),
            'activity' => fn (): array => ActivityFeed::for(['car_of_the_day' => array_values($rows->map(fn (CarOfTheDay $row): string => (string) $row->id)->all())], $staff),
        ]);
    }
}
