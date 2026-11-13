<?php

namespace App\Actions\Maintenance;

use App\Enums\ErrorCode;
use App\Enums\MaintenanceType;
use App\Exceptions\ApiException;
use App\Http\Resources\V1\MaintenanceLogResource;
use App\Models\MaintenanceItem;
use App\Models\MaintenanceLog;
use App\Models\Vehicle;
use App\Services\Maintenance\MaintenanceItems;
use Carbon\CarbonImmutable;

/**
 * MNT-01 "Verlauf" (09 §8.8): add or change a service log entry. An entry of an item moves that item's last time (and so its next due
 * date); its mileage raises the vehicle's odometer. The cost is private to the owner. A client id that exists already answers that entry.
 */
class SaveMaintenanceLog
{
    public const MAX_PER_VEHICLE = 1000;

    private const FIELDS = ['title', 'mileage_km', 'workshop', 'cost_cents', 'notes'];

    public function __construct(private readonly MaintenanceItems $items) {}

    /**
     * @param  array<string, mixed>  $data  validated StoreMaintenanceLogRequest data
     * @return array{0: MaintenanceLog, 1: bool} the entry, whether it was made now
     */
    public function add(Vehicle $vehicle, array $data): array
    {
        return MaintenanceWrites::locked($vehicle, function (Vehicle $locked) use ($data): array {
            $id = isset($data['id']) && is_string($data['id']) ? strtolower($data['id']) : null;

            if ($id !== null && ($existing = MaintenanceLog::query()->find($id)) instanceof MaintenanceLog) {
                if ($existing->vehicle_id !== $locked->id) {
                    throw new ApiException(ErrorCode::Conflict);
                }

                return [$existing, false];
            }

            if (MaintenanceLog::query()->where('vehicle_id', $locked->id)->count() >= self::MAX_PER_VEHICLE) {
                throw new ApiException(ErrorCode::LimitReached);
            }

            $log = new MaintenanceLog;

            if ($id !== null) {
                $log->forceFill(['id' => $id]);
            }

            $log->forceFill(['vehicle_id' => $locked->id, 'currency' => 'EUR', 'version' => 1]);
            $item = $this->apply($locked, $log, $data);
            $log->save();
            $this->after($locked, $log, $item, null);

            return [$log, true];
        });
    }

    /**
     * @param  array<string, mixed>  $data  validated UpdateMaintenanceLogRequest data
     */
    public function change(Vehicle $vehicle, MaintenanceLog $log, array $data): MaintenanceLog
    {
        return MaintenanceWrites::locked($vehicle, function (Vehicle $locked) use ($log, $data): MaintenanceLog {
            /** @var MaintenanceLog $row */
            $row = MaintenanceLog::query()->whereKey($log->id)->where('vehicle_id', $locked->id)->firstOrFail();
            MaintenanceWrites::assertVersion($row, $data, fn (): array => (new MaintenanceLogResource($row))->resolve());
            $before = $row->item_id;
            $item = $this->apply($locked, $row, $data);

            if ($row->isDirty()) {
                $row->forceFill(['version' => $row->version + 1])->save();
                $this->after($locked, $row, $item, $before !== $row->item_id ? $before : null);
            }

            return $row;
        });
    }

    /**
     * @param  array<string, mixed>  $data
     */
    private function apply(Vehicle $vehicle, MaintenanceLog $log, array $data): ?MaintenanceItem
    {
        $item = null;

        if (array_key_exists('item_id', $data)) {
            $itemId = is_string($data['item_id']) ? strtolower($data['item_id']) : null;
            $item = $itemId === null ? null : MaintenanceItem::query()->whereKey($itemId)->where('vehicle_id', $vehicle->id)->first();

            if ($itemId !== null && $item === null) {
                throw new ApiException(ErrorCode::ValidationFailed, errors: ['item_id' => [(string) __('maintenance.item_unknown')]]);
            }

            $log->forceFill(['item_id' => $item?->id]);
        } elseif (is_string($log->item_id)) {
            $item = MaintenanceItem::query()->whereKey($log->item_id)->first();
        }

        if ($item !== null) {
            $log->forceFill(['type' => $item->type]);
        } elseif (isset($data['type']) && is_string($data['type'])) {
            $log->forceFill(['type' => MaintenanceType::from($data['type'])]);
        }

        if (array_key_exists('done_at', $data)) {
            $log->forceFill(['done_at' => $data['done_at']]);
        }

        foreach (self::FIELDS as $field) {
            if (array_key_exists($field, $data)) {
                $log->forceFill([$field => $data[$field]]);
            }
        }

        return $item;
    }

    private function after(Vehicle $vehicle, MaintenanceLog $log, ?MaintenanceItem $item, ?string $previousItem): void
    {
        $this->items->mileageSeen($vehicle, $log->mileage_km, CarbonImmutable::parse($log->done_at->toDateString()));

        foreach (array_filter([$item, $previousItem === null ? null : MaintenanceItem::query()->find($previousItem)]) as $touched) {
            $touched->setRelation('vehicle', $vehicle);
            $this->items->logsChanged($touched);
        }
    }
}
