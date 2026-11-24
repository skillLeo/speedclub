<?php

namespace App\Services\CarOfTheDay;

use App\Enums\Bundesland;
use App\Enums\CarOfTheDaySource;
use App\Enums\MediaStatus;
use App\Enums\ModerationStatus;
use App\Models\CarOfTheDay;
use App\Models\Vehicle;
use App\Services\Discover\VisibleBuilds;
use App\Services\Home\BuildOfWeek;
use Carbon\CarbonImmutable;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\DB;

/**
 * The 17:55 pick (m5.9d contract §3): fixed rules, never random.
 *
 * A candidate is a public build any guest may see in a list (VisibleBuilds: published, public, not ghost, owner active and verified,
 * samples only while they are shown), with a Build Score of at least `min_build_score`, at least `min_photos` usable photos and no
 * feature within `gap_days`. The Bundesland rotates: the 16 in the order of their last pick (never picked first, then the longest ago,
 * ties in the enum's order); the first with a candidate wins, any Bundesland (or none) when none of them has one. Inside a Bundesland the
 * highest Build Score wins, then the vehicle id. Never a sample in production; on staging and local only when no real candidate exists,
 * marked is_sample (the "Beispiel" badge).
 *
 * R4-2.1 (contract-cotd-voting V2, V5), flag cotd_voting: ranked() gives the round's candidates (the top 3 real ones), and pick() takes
 * the most-voted eligible candidate of the day's round before its own rule (tie: the candidate's position; no counted vote: the rule).
 */
final class CarOfTheDayPicker
{
    public function __construct(
        private readonly VisibleBuilds $builds,
        private readonly CarOfTheDayVotes $votes,
    ) {}

    /**
     * Today's row, picked now when there is none. Null when no candidate exists (the next run tries again).
     */
    public function pick(string $day): ?CarOfTheDay
    {
        $existing = CarOfTheDay::query()->where('day', $day)->first();

        if ($existing instanceof CarOfTheDay) {
            return $existing;
        }

        $choice = $this->voted($day) ?? $this->choose($day);

        if ($choice === null) {
            return null;
        }

        $vehicle = Vehicle::query()->findOrFail($choice['vehicle_id']);

        DB::table('car_of_the_day')->insertOrIgnore([
            'day' => $day,
            'vehicle_id' => $vehicle->id,
            'story_line' => BuildOfWeek::quote($vehicle),
            'bundesland' => $choice['bundesland'],
            'source' => CarOfTheDaySource::Auto->value,
            'by_vote' => $choice['by_vote'] ?? false,
            'is_sample' => $choice['sample'],
            'skipped' => false,
            'picked_at' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return CarOfTheDay::query()->where('day', $day)->first();
    }

    /**
     * R4-2.1: the most-voted eligible candidate of the day's round while cotd_voting is on (CarOfTheDayVotes::winner), with the owner's
     * Bundesland; null without a counted vote.
     *
     * @return array{vehicle_id: string, bundesland: string|null, sample: bool, by_vote: bool}|null
     */
    private function voted(string $day): ?array
    {
        $vehicleId = $this->votes->winner($day);

        if ($vehicleId === null) {
            return null;
        }

        $row = DB::table('vehicles as v')->join('users as u', 'u.id', '=', 'v.owner_id')->where('v.id', $vehicleId)
            ->first(['u.bundesland as bundesland', 'v.is_sample as vehicle_sample', 'u.is_sample as owner_sample']);
        $land = $row?->bundesland;
        // ADR-535: outside production a sample candidate can win the count; its row is a badged sample (CarOfTheDayVotes refuses one in production).
        $sample = $row !== null && ((bool) $row->vehicle_sample || (bool) $row->owner_sample);

        return ['vehicle_id' => $vehicleId, 'bundesland' => is_string($land) ? $land : null, 'sample' => $sample, 'by_vote' => true];
    }

    /**
     * R4-2.1 (contract-cotd-voting V2): the round's candidates for $day, best first: the best real candidate of each Bundesland in
     * rotation order until $limit, then the best remaining ones of any Bundesland (or none). Never a sample in production.
     *
     * ADR-535: outside production (local, staging), when fewer than voting.min_candidates real candidates qualify, the round is filled up
     * to $limit with the best sample candidates under the same rules (rotation first, then any Bundesland), after the real ones, so the
     * vote can be seen and tried where nearly every build is a badged showcase sample.
     *
     * @return list<string> vehicle ids
     */
    public function ranked(string $day, int $limit): array
    {
        $picked = $this->rankedOf($day, $limit, false, []);

        if (! app()->environment('production') && count($picked) < config()->integer('speedclub.car_of_the_day.voting.min_candidates')) {
            $picked = [...$picked, ...$this->rankedOf($day, $limit - count($picked), true, $picked)];
        }

        return $picked;
    }

    /**
     * Up to $limit candidates of one kind (real or sample), best of each Bundesland in rotation order first, leaving out $exclude.
     *
     * @param  list<string>  $exclude
     * @return list<string>
     */
    private function rankedOf(string $day, int $limit, bool $samples, array $exclude): array
    {
        $picked = [];
        // ADR-535: the non-production sample fill-up of a vote round takes voting.sample_min_photos (seed builds have 1–3 photos).
        $minPhotos = $samples ? config()->integer('speedclub.car_of_the_day.voting.sample_min_photos') : null;

        if ($limit < 1) {
            return [];
        }

        foreach ($this->rotation() as $land) {
            if (count($picked) >= $limit) {
                break;
            }

            $id = $this->candidates($day, $samples, $minPhotos)->where('u.bundesland', $land)
                ->when($exclude !== [], fn (Builder $query) => $query->whereNotIn('v.id', $exclude))
                ->value('v.id');

            if (is_string($id)) {
                $picked[] = $id;
            }
        }

        if (count($picked) < $limit) {
            $more = $this->candidates($day, $samples, $minPhotos)
                ->when([...$exclude, ...$picked] !== [], fn (Builder $query) => $query->whereNotIn('v.id', [...$exclude, ...$picked]))
                ->limit($limit - count($picked))
                ->pluck('v.id')
                ->map(strval(...))
                ->all();
            $picked = [...$picked, ...$more];
        }

        return array_values($picked);
    }

    /**
     * @return array{vehicle_id: string, bundesland: string|null, sample: bool}|null
     */
    public function choose(string $day): ?array
    {
        $real = $this->best($day, false);

        if ($real !== null) {
            return [...$real, 'sample' => false];
        }

        if (app()->environment('production')) {
            return null;
        }

        $sample = $this->best($day, true);

        return $sample === null ? null : [...$sample, 'sample' => true];
    }

    /**
     * CR-P5G-13: the best candidate of the first Bundesland in rotation order that has one, else of any Bundesland (or none): one row
     * per query (LIMIT 1), never the whole candidate list.
     *
     * @return array{vehicle_id: string, bundesland: string|null}|null
     */
    private function best(string $day, bool $samples): ?array
    {
        foreach ($this->rotation() as $land) {
            $row = $this->candidates($day, $samples)->where('u.bundesland', $land)->first(['v.id as vehicle_id', 'u.bundesland as bundesland']);

            if ($row !== null) {
                return self::row($row);
            }
        }

        $row = $this->candidates($day, $samples)->first(['v.id as vehicle_id', 'u.bundesland as bundesland']);

        return $row === null ? null : self::row($row);
    }

    /**
     * @return array{vehicle_id: string, bundesland: string|null}
     */
    private static function row(object $row): array
    {
        $values = (array) $row;
        $bundesland = $values['bundesland'] ?? null;

        return ['vehicle_id' => (string) ($values['vehicle_id'] ?? ''), 'bundesland' => is_string($bundesland) ? $bundesland : null];
    }

    /**
     * The 16 Bundesländer, the one picked longest ago (or never) first.
     *
     * @return list<string>
     */
    public function rotation(): array
    {
        /** @var array<string, string> $last */
        $last = DB::table('car_of_the_day')
            ->where('skipped', false)
            ->whereNotNull('bundesland')
            ->groupBy('bundesland')
            ->selectRaw('bundesland, MAX(day) as last_day')
            ->pluck('last_day', 'bundesland')
            ->map(strval(...))
            ->all();
        $lands = array_map(fn (Bundesland $land): string => $land->value, Bundesland::cases());
        $order = array_flip($lands);

        usort($lands, fn (string $a, string $b): int => [$last[$a] ?? '', $order[$a]] <=> [$last[$b] ?? '', $order[$b]]);

        return $lands;
    }

    /**
     * The candidates, best first (no columns selected). $samples true: sample builds or owners only (the non-production fallback).
     * $minPhotos: another photo minimum than min_photos (ADR-535, the vote round's sample fill-up only).
     */
    private function candidates(string $day, bool $samples, ?int $minPhotos = null): Builder
    {
        $since = CarbonImmutable::parse($day)->subDays(config()->integer('speedclub.car_of_the_day.gap_days'))->toDateString();

        $query = $this->builds->query(null, fromSearch: false)
            ->join('build_scores as bs', 'bs.vehicle_id', '=', 'v.id')
            ->where('bs.total', '>=', config()->integer('speedclub.car_of_the_day.min_build_score'))
            ->whereRaw('(SELECT COUNT(*) FROM media md WHERE md.mediable_type = ? AND md.mediable_id = v.id AND md.deleted_at IS NULL AND md.status = ? AND md.moderation_status <> ?) >= ?', [
                'vehicle', MediaStatus::Ready->value, ModerationStatus::Rejected->value, $minPhotos ?? config()->integer('speedclub.car_of_the_day.min_photos'),
            ])
            ->whereNotExists(fn (Builder $recent) => $recent->selectRaw('1')->from('car_of_the_day', 'c')
                ->whereColumn('c.vehicle_id', 'v.id')
                ->where('c.day', '>', $since)
                ->where('c.day', '<>', $day));

        if ($samples) {
            $query->where(fn (Builder $sample) => $sample->where('v.is_sample', true)->orWhere('u.is_sample', true));
        } else {
            $query->where('v.is_sample', false)->where('u.is_sample', false);
        }

        return $query->orderByDesc('bs.total')->orderBy('v.id');
    }
}
