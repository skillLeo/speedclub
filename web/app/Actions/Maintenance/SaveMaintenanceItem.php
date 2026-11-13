<?php

namespace App\Actions\Maintenance;

use App\Enums\ErrorCode;
use App\Enums\MaintenanceType;
use App\Exceptions\ApiException;
use App\Http\Resources\V1\MaintenanceItemResource;
use App\Models\MaintenanceItem;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\Maintenance\MaintenanceItems;
use App\Services\Maintenance\MaintenancePrefs;
use App\Services\Maintenance\MaintenanceSchedule;

/**
 * MNT-02 (09 §8.8): add or change a maintenance item. Every type but custom exists once per vehicle (409 conflict with the existing one in
 * `current`); a client id that exists already answers that item (the outbox retried). A date or mileage the member sets is pinned until the
 * next log entry; otherwise last time + interval decide (MaintenanceSchedule). The HU/AU writes its month to vehicles.hu_au_due as well.
 */
class SaveMaintenanceItem
{
    public const MAX_PER_VEHICLE = 30;

    private const FIELDS = ['title', 'interval_months', 'interval_km', 'last_done_at', 'last_done_km', 'enabled', 'notes'];

    public function __construct(private readonly MaintenanceItems $items) {}

    /**
     * @param  array<string, mixed>  $data  validated StoreMaintenanceItemRequest data
     * @return array{0: MaintenanceItem, 1: bool} the item, whether it was made now
     */
    public function add(User $owner, Vehicle $vehicle, array $data): array
    {
        return MaintenanceWrites::locked($vehicle, function (Vehicle $locked) use ($owner, $data): array {
            $id = isset($data['id']) && is_string($data['id']) ? strtolower($data['id']) : null;

            if ($id !== null && ($existing = MaintenanceItem::query()->find($id)) instanceof MaintenanceItem) {
                if ($existing->vehicle_id !== $locked->id) {
                    throw new ApiException(ErrorCode::Conflict);
                }

                return [$existing, false];
            }

            $type = MaintenanceType::from((string) $data['type']);
            $current = $type->isSingleton() ? MaintenanceItem::query()->where('vehicle_id', $locked->id)->where('slot', $type->value)->first() : null;

            if ($current instanceof MaintenanceItem) {
                $current->setRelation('vehicle', $locked);

                throw new ApiException(ErrorCode::Conflict, (string) __('maintenance.type_exists'), data: ['current' => (new MaintenanceItemResource($current))->resolve()]);
            }

            if (MaintenanceItem::query()->where('vehicle_id', $locked->id)->count() >= self::MAX_PER_VEHICLE) {
                throw new ApiException(ErrorCode::LimitReached);
            }

            $item = new MaintenanceItem;

            if ($id !== null) {
                $item->forceFill(['id' => $id]);
            }

            $default = $type->defaultInterval();
            $item->forceFill([
                'vehicle_id' => $locked->id,
                'type' => $type,
                'slot' => $type->isSingleton() ? $type->value : null,
                'interval_months' => $default['months'],
                'interval_km' => $default['km'],
                'lead_days' => $type === MaintenanceType::HuAu ? MaintenancePrefs::for($owner)['hu_au_lead_days'] : $type->defaultLeadDays(),
                'enabled' => true,
                'version' => 1,
            ]);
            $item->setRelation('vehicle', $locked);
            $this->apply($item, $data);
            $item->save();

            return [$item, true];
        });
    }

    /**
     * @param  array<string, mixed>  $data  validated UpdateMaintenanceItemRequest data
     */
    public function change(Vehicle $vehicle, MaintenanceItem $item, array $data): MaintenanceItem
    {
        return MaintenanceWrites::locked($vehicle, function (Vehicle $locked) use ($item, $data): MaintenanceItem {
            /** @var MaintenanceItem $row */
            $row = MaintenanceItem::query()->whereKey($item->id)->where('vehicle_id', $locked->id)->firstOrFail();
            $row->setRelation('vehicle', $locked);
            MaintenanceWrites::assertVersion($row, $data, fn (): array => (new MaintenanceItemResource($row))->resolve());

            $this->apply($row, $data);

            if ($row->isDirty()) {
                $row->forceFill(['version' => $row->version + 1])->save();
            }

            return $row;
        });
    }

    /**
     * @param  array<string, mixed>  $data
     */
    private function apply(MaintenanceItem $item, array $data): void
    {
        foreach (self::FIELDS as $field) {
            if (array_key_exists($field, $data)) {
                $item->forceFill([$field => $field === 'title' && $item->type !== MaintenanceType::Custom ? null : $data[$field]]);
            }
        }

        if (array_key_exists('lead_days', $data)) {
            $days = is_array($data['lead_days']) ? MaintenancePrefs::leadDays($data['lead_days']) : [];
            $item->forceFill(['lead_days' => $days === [] ? $item->type->defaultLeadDays() : $days]);
        }

        if (array_key_exists('next_due_at', $data) || array_key_exists('next_due_km', $data)) {
            $at = array_key_exists('next_due_at', $data) ? $data['next_due_at'] : $item->next_due_at?->toDateString();
            $km = array_key_exists('next_due_km', $data) ? $data['next_due_km'] : $item->next_due_km;

            if (is_string($at) && $item->type === MaintenanceType::HuAu) {
                $at = MaintenanceSchedule::day($at)->startOfMonth()->toDateString();
            }

            $item->forceFill(['next_due_at' => $at, 'next_due_km' => $km, 'due_pinned' => $at !== null || $km !== null]);
        } elseif (array_intersect(array_keys($data), ['last_done_at', 'last_done_km', 'interval_months', 'interval_km']) !== []) {
            // A new last time or interval without a date of its own: computed again.
            $item->forceFill(['due_pinned' => false]);
        }

        $this->items->refresh($item);
    }
}
