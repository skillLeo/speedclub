<?php

namespace App\Http\Resources\V1;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * The reminder plan of the member (09 §8.8 server + local dedupe).
 *
 * @property list<array{key: string, kind: 'date'|'km', item_id: string, vehicle_id: string, type: string, due_on: string|null, due_km: int|null, lead_days: int|null, fire_on: string|null, fire_at: string|null, status: 'planned'|'sent'|'skipped'}> $resource
 */
class MaintenanceReminderPlanResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            /** The zone of fire_on / fire_at and of the daily server run. */
            'timezone' => config()->string('speedclub.notifications.timezone'),
            /**
             * key "mnt:{item}:d{due}:{lead}" or "mnt:{item}:k{km}"; fire_at: the server push (09:00 Europe/Berlin on fire_on); status:
             * planned (schedule the local backup), sent or skipped (drop it).
             *
             * @var list<array{key: string, kind: 'date'|'km', item_id: string, vehicle_id: string, type: string, due_on: string|null, due_km: int|null, lead_days: int|null, fire_on: string|null, fire_at: string|null, status: 'planned'|'sent'|'skipped'}>
             */
            'stages' => $this->resource,
        ];
    }
}
