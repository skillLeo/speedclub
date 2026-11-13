<?php

namespace App\Services\Maintenance;

use App\Enums\MaintenanceType;
use App\Models\MaintenanceItem;
use App\Models\MaintenanceLog;
use App\Models\User;
use App\Models\Vehicle;
use Carbon\CarbonImmutable;

/**
 * Keeps a vehicle's maintenance consistent (09 §8.8): the stored due date and mileage of an item (MaintenanceSchedule), the HU/AU item
 * and vehicles.hu_au_due in step (GAR-06 and MNT-01 edit the same month), an item's last time from its newest log entry, and the
 * vehicle's odometer as the highest mileage known. Callers hold the vehicle's row lock.
 */
final class MaintenanceItems
{
    public function __construct(private readonly MaintenanceSchedule $schedule) {}

    /**
     * Recomputes next_due_at / next_due_km from the item's own fields; for the HU/AU also writes the month to the vehicle.
     */
    public function refresh(MaintenanceItem $item): void
    {
        $due = $this->schedule->nextDueAt($item);
        $item->forceFill([
            'next_due_at' => $due?->toDateString(),
            'next_due_km' => $this->schedule->nextDueKm($item),
        ]);

        if ($item->type === MaintenanceType::HuAu) {
            $vehicle = $item->vehicle;

            if ($vehicle->getAttribute('hu_au_due')?->format('Y-m-d') !== $due?->toDateString()) {
                $vehicle->forceFill(['hu_au_due' => $due?->toDateString()])->save();
            }
        }
    }

    /**
     * GAR-06 changed the HU/AU month of $vehicle: its HU/AU item follows (made with the member's SET-23 lead times when missing). A
     * removed month leaves the item without a date.
     */
    public function huAuMonthChanged(Vehicle $vehicle, ?string $month): void
    {
        $item = MaintenanceItem::query()->where('vehicle_id', $vehicle->id)->where('slot', MaintenanceType::HuAu->value)->first();

        if ($item === null && $month === null) {
            return;
        }

        if ($item === null) {
            $owner = $vehicle->owner;
            $item = new MaintenanceItem;
            $item->forceFill([
                'vehicle_id' => $vehicle->id,
                'type' => MaintenanceType::HuAu,
                'slot' => MaintenanceType::HuAu->value,
                'interval_months' => MaintenanceType::HuAu->defaultInterval()['months'],
                'lead_days' => $owner instanceof User ? MaintenancePrefs::for($owner)['hu_au_lead_days'] : MaintenanceType::HuAu->defaultLeadDays(),
                'enabled' => true,
            ]);
        }

        $item->forceFill(['next_due_at' => $month, 'due_pinned' => $month !== null]);

        if ($item->isDirty()) {
            $item->forceFill(['version' => ($item->version ?? 0) + 1])->save();
        }
    }

    /**
     * After a log entry of $item was written, changed or deleted: the last time is the newest entry's (a manual last time stays when
     * there is no entry), a date the member pinned gives way to the interval, and the due date follows.
     */
    public function logsChanged(MaintenanceItem $item): void
    {
        $newest = MaintenanceLog::query()->where('item_id', $item->id)->orderByDesc('done_at')->orderByDesc('id')->first();

        if ($newest !== null) {
            $changed = $item->last_done_at?->toDateString() !== $newest->done_at->toDateString() || $item->last_done_km !== $newest->mileage_km;
            $item->forceFill(['last_done_at' => $newest->done_at->toDateString(), 'last_done_km' => $newest->mileage_km]);

            if ($changed && ($item->interval_months !== null || $item->interval_km !== null || $item->type->schedule() !== 'interval')) {
                $item->forceFill(['due_pinned' => false]);
            }
        }

        $this->refresh($item);

        if ($item->isDirty()) {
            $item->forceFill(['version' => $item->version + 1])->save();
        }
    }

    /**
     * The odometer only goes up through log entries; RecordOdometer sets it as the member says.
     */
    public function mileageSeen(Vehicle $vehicle, ?int $km, ?CarbonImmutable $at = null): void
    {
        $current = $vehicle->getAttribute('odometer_km');

        if ($km !== null && (! is_int($current) || $km > $current)) {
            $vehicle->forceFill(['odometer_km' => $km, 'odometer_at' => $at ?? now()])->save();
        }
    }
}
