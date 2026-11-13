<?php

namespace App\Services\Maintenance;

use App\Enums\MaintenanceDueState;
use App\Enums\ModStatus;
use App\Models\MaintenanceItem;
use App\Models\MaintenanceLog;
use App\Models\Modification;
use App\Models\User;
use App\Models\Vehicle;
use Carbon\CarbonImmutable;
use Illuminate\Support\Collection;

/**
 * The owner's reads across items: "Nächste Fälligkeiten" (Garage, the Android widget), the reminder plan the app's local notifications
 * follow, and the private cost totals of a vehicle. All of it owner-only; computed in PHP over a member's few vehicles, the same on MySQL
 * and MariaDB.
 */
final class MaintenanceOverview
{
    public function __construct(
        private readonly MaintenanceSchedule $schedule,
        private readonly MaintenanceReminders $reminders,
    ) {}

    /**
     * Enabled items of the member's vehicles (not deleted) that are overdue, within $days of their date or within 1,000 km: overdue first,
     * then the nearest.
     *
     * @return Collection<int, MaintenanceItem>
     */
    public function upcoming(User $owner, int $days, int $limit): Collection
    {
        $today = MaintenanceSchedule::today();

        return $this->items($owner)
            ->filter(function (MaintenanceItem $item) use ($days, $today): bool {
                $state = $this->schedule->state($item, $this->odometer($item), $today);
                $left = $this->schedule->daysLeft($item, $today);

                return $state === MaintenanceDueState::Overdue || $state === MaintenanceDueState::Soon || ($left !== null && $left <= $days);
            })
            ->sortBy(fn (MaintenanceItem $item): array => [
                $this->schedule->state($item, $this->odometer($item), $today) === MaintenanceDueState::Overdue ? 0 : 1,
                $this->schedule->daysLeft($item, $today) ?? PHP_INT_MAX,
                $this->schedule->kmLeft($item, $this->odometer($item)) ?? PHP_INT_MAX,
            ])
            ->take($limit)
            ->values();
    }

    /**
     * Every reminder stage of the member's reminding items (09 §8.8): the planned ones the app schedules as local backups, and those the
     * server already handled (sent or skipped) so the app drops its copy. Only items that remind (switched on, SET-23, a real vehicle).
     *
     * @return list<array{key: string, kind: 'date'|'km', item_id: string, vehicle_id: string, type: string, due_on: string|null, due_km: int|null, lead_days: int|null, fire_on: string|null, fire_at: string|null, status: 'planned'|'sent'|'skipped'}>
     */
    public function reminderPlan(User $owner): array
    {
        $plan = [];
        $tz = config()->string('speedclub.notifications.timezone');

        foreach ($this->items($owner) as $item) {
            $vehicle = $item->vehicle;

            if ($vehicle->getAttribute('is_sample') === true || $owner->getAttribute('is_sample') === true || ! $this->reminders->active($item, $owner)) {
                continue;
            }

            foreach ($this->reminders->stages($item) as $stage) {
                $plan[] = [
                    ...$stage,
                    'item_id' => $item->id,
                    'vehicle_id' => $item->vehicle_id,
                    'type' => $item->type->value,
                    // The server's push goes out with the daily run at 09:00 Europe/Berlin of this day.
                    'fire_at' => $stage['fire_on'] === null ? null : CarbonImmutable::parse($stage['fire_on'].' '.MaintenanceReminders::HOUR, $tz)->toIso8601String(),
                ];
            }
        }

        usort($plan, fn (array $a, array $b): int => [$a['fire_on'] ?? '9999', $a['key']] <=> [$b['fire_on'] ?? '9999', $b['key']]);

        return $plan;
    }

    /**
     * Private cost totals of a vehicle (09 §11: cost private): service log entries by their date, mods (installed or removed, not planned)
     * by their install date or, without one, when they were entered. Euro cents.
     *
     * @return array{currency: string, total_cents: int, maintenance_cents: int, mods_cents: int, years: list<array{year: int, total_cents: int, maintenance_cents: int, mods_cents: int}>}
     */
    public function costs(Vehicle $vehicle): array
    {
        $years = [];

        foreach (MaintenanceLog::query()->where('vehicle_id', $vehicle->id)->whereNotNull('cost_cents')->get(['done_at', 'cost_cents']) as $log) {
            $year = (int) $log->done_at->format('Y');
            $years[$year]['maintenance'] = ($years[$year]['maintenance'] ?? 0) + (int) $log->cost_cents;
        }

        foreach (Modification::query()->where('vehicle_id', $vehicle->id)->whereNotNull('cost_cents')->where('status', '!=', ModStatus::Planned->value)
            ->get(['installed_on', 'created_at', 'cost_cents']) as $mod) {
            $date = $mod->getAttribute('installed_on') ?? $mod->getAttribute('created_at');
            $year = $date instanceof \DateTimeInterface ? (int) $date->format('Y') : (int) now()->format('Y');
            $years[$year]['mods'] = ($years[$year]['mods'] ?? 0) + (int) $mod->getAttribute('cost_cents');
        }

        krsort($years);
        $rows = [];

        foreach ($years as $year => $sums) {
            $maintenance = $sums['maintenance'] ?? 0;
            $mods = $sums['mods'] ?? 0;
            $rows[] = ['year' => $year, 'total_cents' => $maintenance + $mods, 'maintenance_cents' => $maintenance, 'mods_cents' => $mods];
        }

        $maintenance = array_sum(array_column($rows, 'maintenance_cents'));
        $mods = array_sum(array_column($rows, 'mods_cents'));

        return ['currency' => 'EUR', 'total_cents' => $maintenance + $mods, 'maintenance_cents' => $maintenance, 'mods_cents' => $mods, 'years' => $rows];
    }

    /**
     * @return Collection<int, MaintenanceItem>
     */
    private function items(User $owner): Collection
    {
        return MaintenanceItem::query()
            ->whereIn('vehicle_id', Vehicle::query()->where('owner_id', $owner->id)->select('id'))
            ->where('enabled', true)
            ->with(['vehicle.make', 'vehicle.vehicleModel', 'vehicle.generation', 'vehicle.cover', 'vehicle.owner'])
            ->orderBy('id')
            ->get();
    }

    private function odometer(MaintenanceItem $item): ?int
    {
        $km = $item->vehicle->getAttribute('odometer_km');

        return is_int($km) ? $km : null;
    }
}
