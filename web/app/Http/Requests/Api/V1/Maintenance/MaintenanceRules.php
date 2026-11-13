<?php

namespace App\Http\Requests\Api\V1\Maintenance;

use App\Enums\MaintenanceType;
use App\Http\Requests\Api\V1\Messaging\MessagingRules;
use App\Services\Maintenance\MaintenancePrefs;
use Illuminate\Validation\Rule;

/**
 * The fields of MNT-02 (maintenance item) and of a service log entry (09 §8.8, §11). Distances in km, money in cents (EUR): the app
 * converts what the member typed in mi (SET-11) before sending. Dates are calendar days (YYYY-MM-DD).
 */
final class MaintenanceRules
{
    public const MAX_KM = 2_000_000;

    public const MAX_COST_CENTS = 10_000_000;

    /**
     * @return array<string, mixed>
     */
    public static function item(bool $creating): array
    {
        $sometimes = $creating ? [] : ['sometimes'];

        return [
            ...($creating ? [
                /** Client-generated ULID for the offline outbox (09 §8.12): sending it again answers the item already made. */
                'id' => ['sometimes', 'string', MessagingRules::ULID],
                'type' => ['required', Rule::enum(MaintenanceType::class)],
            ] : [
                /** The `version` the edit started from: a newer one on the server answers 409 edit_conflict with `current`. */
                'version' => ['sometimes', 'integer', 'min:1'],
            ]),
            /** Required for custom items, ignored otherwise ("Zahnriemen", "Klimaservice"). */
            'title' => [...($creating ? ['required_if:type,custom'] : ['sometimes']), 'nullable', 'string', 'max:80'],
            'interval_months' => [...$sometimes, 'nullable', 'integer', 'min:1', 'max:120'],
            'interval_km' => [...$sometimes, 'nullable', 'integer', 'min:100', 'max:500000'],
            'last_done_at' => [...$sometimes, 'nullable', 'date_format:Y-m-d', 'before_or_equal:'.now()->addDay()->toDateString(), 'after:1950-01-01'],
            'last_done_km' => [...$sometimes, 'nullable', 'integer', 'min:0', 'max:'.self::MAX_KM],
            /** The member's own due date (service booklet, HU/AU plakette: any day of the month, stored as its first). Null: computed. */
            'next_due_at' => [...$sometimes, 'nullable', 'date_format:Y-m-d', 'after:2000-01-01', 'before:2100-01-01'],
            'next_due_km' => [...$sometimes, 'nullable', 'integer', 'min:0', 'max:'.self::MAX_KM],
            /** Days before the due date to remind, at most three, 0–90 (default per type; the HU/AU's from SET-23). */
            'lead_days' => [...$sometimes, 'nullable', 'array', 'max:'.MaintenancePrefs::MAX_LEADS],
            'lead_days.*' => ['integer', 'distinct', 'min:0', 'max:'.MaintenancePrefs::MAX_LEAD_DAYS],
            'enabled' => [...$sometimes, 'boolean:strict'],
            'notes' => [...$sometimes, 'nullable', 'string', 'max:500'],
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public static function log(bool $creating): array
    {
        $sometimes = $creating ? [] : ['sometimes'];

        return [
            ...($creating ? [
                /** Client-generated ULID for the offline outbox (09 §8.12). */
                'id' => ['sometimes', 'string', MessagingRules::ULID],
            ] : [
                'version' => ['sometimes', 'integer', 'min:1'],
            ]),
            /** The item this entry completes (its type wins); null for an entry of its own. */
            'item_id' => [...$sometimes, 'nullable', 'string', MessagingRules::ULID],
            'type' => [...($creating ? ['required_without:item_id'] : ['sometimes']), 'nullable', Rule::enum(MaintenanceType::class)],
            'title' => [...$sometimes, 'nullable', 'string', 'max:80'],
            'done_at' => [...($creating ? ['required'] : ['sometimes', 'required']), 'date_format:Y-m-d', 'before_or_equal:'.now()->addDay()->toDateString(), 'after:1950-01-01'],
            'mileage_km' => [...$sometimes, 'nullable', 'integer', 'min:0', 'max:'.self::MAX_KM],
            /** Free text until business profiles exist (M4.14 links a business). */
            'workshop' => [...$sometimes, 'nullable', 'string', 'max:120'],
            /** Private, always: only the owner ever reads it. Euro cents. */
            'cost_cents' => [...$sometimes, 'nullable', 'integer', 'min:0', 'max:'.self::MAX_COST_CENTS],
            'notes' => [...$sometimes, 'nullable', 'string', 'max:1000'],
        ];
    }
}
