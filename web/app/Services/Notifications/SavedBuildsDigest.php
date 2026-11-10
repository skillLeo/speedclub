<?php

namespace App\Services\Notifications;

use App\Enums\UserStatus;
use App\Enums\VehicleStatus;
use App\Models\Save;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\AppConfig\FeatureFlags;
use Carbon\CarbonImmutable;
use Illuminate\Database\Query\Builder;

/**
 * [SIG sig.saved_builds] The weekly build_saved aggregate (02_PRODUCT_SPEC §3.5, §7): on Monday morning (Europe/Berlin) every owner whose
 * build was saved in the ISO week before gets one row per build, "3 Mitglieder haben deinen R34 gespeichert", never who. Saves count when
 * the saver is an active, verified member other than the owner without a block either way; unsaving later does not take one back.
 *
 * The command only queues the first slice (SendSavedBuildsDigestSlice); each slice handles slice_size builds in id order and queues the
 * next, so no run holds the cron worker past its 50 s (M2.2 review #13). Running a week twice changes nothing (group per build and week).
 */
class SavedBuildsDigest
{
    public function __construct(
        private readonly Notifier $notifier,
        private readonly FeatureFlags $flags,
    ) {}

    /**
     * Queues the digest of the ISO week before $now. Returns the week ("2026-W45"), or null with the flag off.
     */
    public function run(?CarbonImmutable $now = null): ?string
    {
        if (! $this->flags->enabled('sig.saved_builds')) {
            return null;
        }

        $week = self::weekStart(($now ?? CarbonImmutable::now()))->subWeek()->isoFormat('GGGG-[W]WW');
        SendSavedBuildsDigestSlice::dispatch($week);

        return $week;
    }

    /**
     * Notifies the owners of up to $limit builds after $afterVehicleId. Returns the last vehicle id handled, or null when none was left.
     */
    public function slice(string $week, string $afterVehicleId, int $limit): ?string
    {
        if (! $this->flags->enabled('sig.saved_builds') || preg_match('/\A(\d{4})-W(\d{2})\z/', $week, $parts) !== 1) {
            return null;
        }

        $start = CarbonImmutable::now(config()->string('speedclub.notifications.timezone'))->setISODate((int) $parts[1], (int) $parts[2])->startOfDay();
        $end = $start->addWeek();

        $totals = Save::query()->toBase()->from('saves', 's')
            ->join('vehicles as v', 'v.id', '=', 's.vehicle_id')
            ->join('users as m', 'm.id', '=', 's.user_id')
            ->whereNull('v.deleted_at')
            ->where('v.status', VehicleStatus::Published->value)
            ->whereColumn('s.user_id', '!=', 'v.owner_id')
            ->where('s.created_at', '>=', $start->utc())
            ->where('s.created_at', '<', $end->utc())
            ->whereNull('m.deleted_at')
            ->where('m.status', UserStatus::Active->value)
            ->whereNotNull('m.email_verified_at')
            ->whereNotExists(fn (Builder $block) => $block->selectRaw('1')->from('blocks', 'b')
                ->where(fn (Builder $pair) => $pair->whereColumn('b.blocker_id', 's.user_id')->whereColumn('b.blocked_id', 'v.owner_id'))
                ->orWhere(fn (Builder $pair) => $pair->whereColumn('b.blocker_id', 'v.owner_id')->whereColumn('b.blocked_id', 's.user_id')))
            ->when($afterVehicleId !== '', fn (Builder $query) => $query->where('s.vehicle_id', '>', $afterVehicleId))
            ->groupBy('s.vehicle_id', 'v.owner_id')
            ->selectRaw('s.vehicle_id as vehicle_id, v.owner_id as owner_id, COUNT(*) as total')
            ->orderBy('s.vehicle_id')
            ->limit($limit)
            ->get();

        if ($totals->isEmpty()) {
            return null;
        }

        $owners = User::query()->whereKey($totals->pluck('owner_id')->unique()->values()->all())->get()->keyBy('id');
        $vehicles = Vehicle::query()->whereKey($totals->pluck('vehicle_id')->all())->get()->keyBy('id');
        $last = null;

        foreach ($totals as $total) {
            $values = get_object_vars($total);
            $last = (string) $values['vehicle_id'];
            $owner = $owners->get((string) $values['owner_id']);
            $vehicle = $vehicles->get($last);

            if ($owner instanceof User && $vehicle instanceof Vehicle) {
                $this->notifier->buildSaved($owner, $vehicle, (int) $values['total'], $week);
            }
        }

        return $last;
    }

    private static function weekStart(CarbonImmutable $moment): CarbonImmutable
    {
        return $moment->setTimezone(config()->string('speedclub.notifications.timezone'))->startOfWeek(CarbonImmutable::MONDAY);
    }
}
