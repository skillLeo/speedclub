<?php

namespace App\Actions\Admin\Moderation;

use App\Enums\GiftEvent;
use App\Models\DexSet;
use App\Models\Spot;
use App\Models\Staff;
use App\Models\User;
use App\Services\Admin\Members\BulkRunner;
use App\Services\Admin\Members\StaffAtoms;
use App\Services\Audit\Audit;
use App\Services\BuildScore\BuildScores;
use App\Services\Dex\DexSets;
use App\Services\Dex\SpotStats;
use App\Services\Progress\XpHooks;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * ADM-62 "Spot entfernen" (m5.9b contract §7; moderation.decide, recent password, reason 10–1000 characters): a soft delete of the spot
 * with an audited reason (`spot.removed`, before/after), then the car's vehicle_spot_stats (SpotStats::recompute) and the spotter's set
 * progress (DexSets::repair, which never takes back a completed set by itself; see SEC-P5G-05 below) are rebuilt by the Dex services. Idempotent: a spot that is already
 * removed changes nothing and records nothing. Not on the four-eyes list (one spot).
 *
 * Bulk (a burst): at most MAX_BULK spots per request, each removed and audited on its own (BulkRunner, one transaction per spot), the
 * stats and sets of every car and spotter touched rebuilt once after the run, plus one `spot.bulk_removed` summary. 06 §2 makes a bulk
 * action over 100 records four-eyes; with no approval handler for spots, a run that would take the staff member past 100 direct
 * removals in 24 hours (ADR-229 window) is refused instead.
 *
 * M5.9d (XP): removing a spot deletes the XP event it earned (XpHooks::spotRemoved).
 *
 * SEC-P5G-05 (the contract's "except for abuse"): a completed set of the spotter that rested on the removed spots and is no longer
 * complete loses its completion and its 100 XP (DexSets::completedWith before, revokeIncomplete after), audited `dex.set_revoked` with
 * the staff member's reason. Badges already earned are not taken back here; the car's Build Score is recomputed (its community part
 * counts spotters).
 */
class RemoveSpots
{
    public const EVENT = 'spot.removed';

    public const BULK_EVENT = 'spot.bulk_removed';

    public const MAX_BULK = 50;

    public function __construct(
        private readonly SpotStats $stats,
        private readonly DexSets $sets,
    ) {}

    /**
     * @return array{removed: bool, spot: Spot}|null null when there is no such spot
     *
     * @throws AuthorizationException
     */
    public function one(Staff $staff, string $id, string $reason): ?array
    {
        StaffAtoms::ensure($staff, 'moderation.decide');

        return DB::transaction(function () use ($staff, $id, $reason): ?array {
            $spot = Spot::withTrashed()->lockForUpdate()->find(strtolower($id));

            if (! $spot instanceof Spot) {
                return null;
            }

            if ($spot->trashed()) {
                return ['removed' => false, 'spot' => $spot];
            }

            $before = self::snapshot($spot);
            $spotter = User::query()->find($spot->spotter_id);
            $candidates = $spotter instanceof User ? $this->sets->completedWith($spotter, [(string) $spot->vehicle_id]) : [];
            $spot->delete();
            $stat = $this->stats->recompute($spot->vehicle_id);
            $this->repairSets($spot->spotter_id);
            // M5.9d: the XP event this spot earned goes.
            app(XpHooks::class)->spotRemoved($spot);
            app(BuildScores::class)->touch((string) $spot->vehicle_id);

            Audit::record(self::EVENT, $spot, $before, [
                'deleted_at' => $spot->getAttribute('deleted_at')?->toIso8601String(),
                'vehicle_stats' => ['total' => $stat->total, 'unique_spotters' => $stat->unique_spotters, 'cities_count' => $stat->cities_count],
            ], trim($reason), $staff);

            if ($spotter instanceof User) {
                $this->revokeSets($staff, $spotter, $candidates, trim($reason));
            }

            return ['removed' => true, 'spot' => $spot];
        }, 3);
    }

    /**
     * @param  array<mixed>  $ids
     * @return list<array{id: string, ok: bool, code: string|null}>
     *
     * @throws AuthorizationException|ValidationException
     */
    public function many(Staff $staff, array $ids, string $reason): array
    {
        StaffAtoms::ensure($staff, 'moderation.decide');
        $ids = BulkRunner::ids($ids);

        if (count($ids) > self::MAX_BULK) {
            throw ValidationException::withMessages(['ids' => [(string) __('validation.max.array', ['attribute' => 'ids', 'max' => self::MAX_BULK])]]);
        }

        $busy = fn (): never => throw ValidationException::withMessages(['ids' => ['spots.bulk.busy']]);

        return BulkRunner::alone($staff, self::BULK_EVENT, $busy, function () use ($staff, $ids, $reason): array {
            if (count($ids) + BulkRunner::recentDirect($staff, self::BULK_EVENT) > BulkRunner::APPROVAL_ABOVE) {
                throw ValidationException::withMessages(['ids' => ['spots.bulk.window']]);
            }

            $reason = trim($reason);
            // SEC-P5G-05: what each spotter's completed sets rest on, read before anything is removed.
            $candidates = [];

            foreach (Spot::query()->whereKey(array_map(strtolower(...), $ids))->get(['id', 'spotter_id', 'vehicle_id'])->groupBy('spotter_id') as $spotterId => $spots) {
                $spotter = User::query()->find($spotterId);

                if ($spotter instanceof User) {
                    $candidates[(string) $spotterId] = [$spotter, $this->sets->completedWith($spotter, array_values($spots->pluck('vehicle_id')->map(strval(...))->unique()->all()))];
                }
            }

            /** @var array<string, true> $vehicles */
            $vehicles = [];
            /** @var array<string, true> $spotters */
            $spotters = [];
            $already = [];

            $rows = BulkRunner::each($ids, function (string $id) use ($staff, $reason, &$vehicles, &$spotters, &$already): bool {
                $spot = Spot::withTrashed()->lockForUpdate()->find($id);

                if (! $spot instanceof Spot) {
                    return false;
                }

                if ($spot->trashed()) {
                    $already[] = $id;

                    return true;
                }

                $before = self::snapshot($spot);
                $spot->delete();
                // M5.9d: the XP event this spot earned goes too.
                app(XpHooks::class)->spotRemoved($spot);
                $vehicles[$spot->vehicle_id] = true;
                $spotters[$spot->spotter_id] = true;
                Audit::record(self::EVENT, $spot, $before, ['deleted_at' => $spot->getAttribute('deleted_at')?->toIso8601String(), 'bulk' => true], $reason, $staff);

                return true;
            });

            // Once per car and spotter after the run; the nightly repair (DexNightly) catches a run that dies before this line.
            DB::transaction(function () use ($vehicles, $spotters, $candidates, $staff, $reason): void {
                $this->stats->recomputeMany(array_map(strval(...), array_keys($vehicles)));
                foreach (array_keys($spotters) as $spotter) {
                    $this->repairSets((string) $spotter);

                    if (isset($candidates[(string) $spotter])) {
                        $this->revokeSets($staff, $candidates[(string) $spotter][0], $candidates[(string) $spotter][1], $reason);
                    }
                }

                foreach (array_keys($vehicles) as $vehicle) {
                    app(BuildScores::class)->touch((string) $vehicle);
                }
            }, 3);

            $rows = array_map(fn (array $row): array => in_array($row['id'], $already, true) ? [...$row, 'code' => 'already_removed'] : $row, $rows);
            $removed = count(array_filter($rows, fn (array $row): bool => $row['ok'] && $row['code'] === null));
            Audit::record(self::BULK_EVENT, null, null, ['records' => $removed, 'requested' => count($ids), 'cars' => count($vehicles), 'spotters' => count($spotters)], $reason, $staff);

            return $rows;
        });
    }

    /**
     * What the audit keeps of a spot: ids, city id and name, flags and time; never a coordinate (there is none).
     *
     * @return array<string, mixed>
     */
    private static function snapshot(Spot $spot): array
    {
        return [
            'vehicle_id' => $spot->vehicle_id,
            'spotter_id' => $spot->spotter_id,
            'city_id' => $spot->city_id,
            'city' => $spot->city?->name,
            'counted' => $spot->counted,
            'is_night' => $spot->is_night,
            'is_first_three' => $spot->is_first_three,
            'created_at' => $spot->created_at?->toIso8601String(),
            'deleted_at' => null,
        ];
    }

    /**
     * @param  list<array{set: DexSet, period: string}>  $candidates
     */
    private function revokeSets(Staff $staff, User $spotter, array $candidates, string $reason): void
    {
        if ($candidates === []) {
            return;
        }

        $revoked = $this->sets->revokeIncomplete($spotter, $candidates);

        if ($revoked !== []) {
            Audit::record(GiftEvent::DexSetRevoked->value, $spotter, ['completed' => $revoked], ['completed' => []], $reason, $staff);
        }
    }

    private function repairSets(string $spotterId): void
    {
        $spotter = User::query()->find($spotterId);

        if ($spotter instanceof User) {
            $this->sets->repair($spotter);
        }
    }
}
