<?php

namespace App\Services\CarOfTheDay;

use App\Enums\MediaStatus;
use App\Enums\ModerationStatus;
use App\Enums\UserStatus;
use App\Models\CarOfTheDay;
use App\Services\AppConfig\FeatureFlags;
use Carbon\CarbonImmutable;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\DB;

/**
 * R4-2.1 counting (contract-cotd-voting V5, V8). A vote counts while its account exists and is active (removed or blocked accounts'
 * votes drop out) and while its candidate may still be the Car of the Day (CarOfTheDays::eligible, never a sample in production, not
 * featured within gap_days, the pick's score and photo minimums). ADR-535: outside production a sample candidate (a round filled up with
 * samples) may win the count; sample accounts still never vote (V4). The counts are staff data: no member response reads them, only winner() (the 17:55 pick) and the staff methods.
 */
final class CarOfTheDayVotes
{
    public const FLAG = 'cotd_voting';

    public function __construct(
        private readonly CarOfTheDays $days,
        private readonly FeatureFlags $flags,
    ) {}

    public function enabled(): bool
    {
        return $this->flags->enabled(self::FLAG);
    }

    /**
     * The most-voted eligible candidate of $day's round while voting is on; a tie goes to the lower position (the Picker's order). Null
     * when voting is off, the day had no round, or no candidate has a counted vote.
     */
    public function winner(string $day): ?string
    {
        if (! $this->enabled()) {
            return null;
        }

        $rows = $this->counted($day);
        usort($rows, fn (array $a, array $b): int => [$b['counted'], $a['position']] <=> [$a['counted'], $b['position']]);

        foreach ($rows as $row) {
            if ($row['counted'] < 1) {
                return null;
            }

            if ($this->eligible($day, $row['vehicle_id'])) {
                return $row['vehicle_id'];
            }
        }

        return null;
    }

    /**
     * Staff (ADM-60): every candidate of $day's round in position order with all its votes and the ones that count now. Read-only.
     *
     * @return list<array{vehicle_id: string, position: int, votes: int, counted: int}>
     */
    public function staffTally(string $day): array
    {
        return $this->counted($day);
    }

    /**
     * Staff (ADM-60): staffTally() for every round from $from to $to (Y-m-d, inclusive), keyed by day, oldest first.
     *
     * @return array<string, list<array{vehicle_id: string, position: int, votes: int, counted: int}>>
     */
    public function staffDays(string $from, string $to): array
    {
        $days = DB::table('car_of_the_day_candidates')->whereBetween('day', [$from, $to])->distinct()->orderBy('day')->pluck('day')
            ->map(fn (mixed $day): string => CarbonImmutable::parse((string) $day)->toDateString())->all();
        $out = [];

        foreach ($days as $day) {
            $out[$day] = $this->counted($day);
        }

        return $out;
    }

    /**
     * @return list<array{vehicle_id: string, position: int, votes: int, counted: int}>
     */
    private function counted(string $day): array
    {
        $all = fn (Builder $votes) => $votes->selectRaw('COUNT(*)')->from('car_of_the_day_votes', 'cv')
            ->whereColumn('cv.vehicle_id', 'c.vehicle_id')->whereColumn('cv.day', 'c.day');
        $valid = fn (Builder $votes) => $all($votes)->join('users as vu', 'vu.id', '=', 'cv.user_id')
            ->whereNull('vu.deleted_at')->where('vu.status', UserStatus::Active->value)->where('vu.is_sample', false);

        return array_values(DB::table('car_of_the_day_candidates', 'c')
            ->where('c.day', $day)
            ->orderBy('c.position')
            ->select(['c.vehicle_id', 'c.position'])
            ->selectSub($all, 'votes')
            ->selectSub($valid, 'counted')
            ->get()
            ->map(fn (object $row): array => [
                'vehicle_id' => (string) $row->vehicle_id,
                'position' => (int) $row->position,
                'votes' => (int) $row->votes,
                'counted' => (int) $row->counted,
            ])
            ->all());
    }

    /**
     * May $vehicleId still be the Car of the Day of $day: listed for a guest, never a sample in production (ADR-535), not featured within gap_days, and still
     * meeting the pick's minimums now (Build Score, usable photos: moderation may have taken photos down after the freeze).
     */
    private function eligible(string $day, string $vehicleId): bool
    {
        $sample = DB::table('vehicles as v')->join('users as u', 'u.id', '=', 'v.owner_id')->where('v.id', $vehicleId)
            ->where(fn (Builder $either) => $either->where('v.is_sample', true)->orWhere('u.is_sample', true))->exists();

        if ($sample && app()->environment('production')) {
            return false;
        }

        // ADR-535: a sample candidate (outside production only) is held to the photo minimum it was frozen with.
        $minPhotos = $sample ? config()->integer('speedclub.car_of_the_day.voting.sample_min_photos') : config()->integer('speedclub.car_of_the_day.min_photos');
        $score = DB::table('build_scores')->where('vehicle_id', $vehicleId)->value('total');
        $photos = DB::table('media')->where('mediable_type', 'vehicle')->where('mediable_id', $vehicleId)->whereNull('deleted_at')
            ->where('status', MediaStatus::Ready->value)->where('moderation_status', '<>', ModerationStatus::Rejected->value)->count();

        if ((int) $score < config()->integer('speedclub.car_of_the_day.min_build_score') || $photos < $minPhotos) {
            return false;
        }

        $since = CarbonImmutable::parse($day)->subDays(config()->integer('speedclub.car_of_the_day.gap_days'))->toDateString();
        $recent = DB::table('car_of_the_day')->where('vehicle_id', $vehicleId)->where('day', '>', $since)->where('day', '<>', $day)->exists();

        if ($recent) {
            return false;
        }

        return $this->days->eligible((new CarOfTheDay)->forceFill(['vehicle_id' => $vehicleId, 'is_sample' => $sample]));
    }
}
