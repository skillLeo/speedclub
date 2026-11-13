<?php

namespace App\Http\Resources\V1;

use App\Enums\MaintenanceDueState;
use App\Enums\MaintenanceType;
use App\Http\Resources\Concerns\AnswersDelivery;
use App\Models\MaintenanceItem;
use App\Services\Maintenance\MaintenanceReminders;
use App\Services\Maintenance\MaintenanceSchedule;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A MaintenanceCard of MNT-01 (09 §7.12, §8.8). Owner-only, like every maintenance answer. Distances in km and money in cents: the app
 * shows them in the member's SET-11 units.
 *
 * @property MaintenanceItem $resource
 */
class MaintenanceItemResource extends JsonResource
{
    use AnswersDelivery;

    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $item = $this->resource;
        $schedule = app(MaintenanceSchedule::class);
        $odometer = $item->vehicle->getAttribute('odometer_km');
        $odometer = is_int($odometer) ? $odometer : null;

        return [
            'id' => $item->id,
            'vehicle_id' => $item->vehicle_id,
            /** @var MaintenanceType */
            'type' => $item->type,
            /** Custom items only; the app names the other types itself. */
            'title' => $item->title,
            'interval' => ['months' => $item->interval_months, 'km' => $item->interval_km],
            'last_done' => ['date' => $item->last_done_at?->toDateString(), 'km' => $item->last_done_km],
            'next_due' => [
                /** YYYY-MM-DD; the first day of the month for the HU/AU. */
                'date' => $item->next_due_at?->toDateString(),
                /** HU/AU only: the month on the plakette, "2027-03". */
                'month' => $item->type === MaintenanceType::HuAu ? $item->next_due_at?->format('Y-m') : null,
                'km' => $item->next_due_km,
                /** The member set the date or mileage (service booklet); a new log entry computes it again. */
                'pinned' => $item->due_pinned,
                /** The last day before it counts as overdue (the end of the HU/AU month). */
                'deadline' => $schedule->deadline($item)?->toDateString(),
            ],
            /** Tyre change: which tyres go on next. */
            'season' => $schedule->season($item),
            /** @var list<int> */
            'lead_days' => $item->leadDays(),
            'enabled' => $item->enabled,
            'notes' => $item->notes,
            /** @var MaintenanceDueState */
            'state' => $schedule->state($item, $odometer),
            /**
             * Days to the due date, negative once past it.
             *
             * @var int|null
             */
            'days_left' => $schedule->daysLeft($item),
            /**
             * Kilometres to the due mileage, negative once past it; null without a due mileage or a known odometer.
             *
             * @var int|null
             */
            'km_left' => $schedule->kmLeft($item, $odometer),
            /**
             * 0–1, how much of the interval has passed (the ring), or null.
             *
             * @var float|null
             */
            'progress' => $schedule->progress($item, $odometer),
            /**
             * The reminder stages of the current due date (09 §8.8 "server + local dedupe"): `key` is the id of the local backup notification.
             *
             * @var list<array{key: string, kind: 'date'|'km', due_on: string|null, due_km: int|null, lead_days: int|null, fire_on: string|null, status: 'planned'|'sent'|'skipped'}>
             */
            'reminders' => app(MaintenanceReminders::class)->stages($item),
            /** Send it back with a PATCH: a newer one on the server answers 409 edit_conflict. */
            'version' => $item->version,
            'updated_at' => $item->updated_at?->toIso8601String(),
        ];
    }
}
