<?php

namespace App\Services\Maintenance;

use App\Enums\DistanceUnit;
use App\Enums\MaintenanceType;
use App\Models\User;
use App\Services\Notifications\NotificationTexts;
use App\Support\Units;
use Carbon\CarbonImmutable;

/**
 * The sentence of a maintenance reminder (push and e-mail, 09 §8.8, §4.9: no emoji) in the owner's language and distance unit, from a
 * maintenance_due row's data: "Der Ölwechsel für BMW M3 ist am 14. Juni 2027 fällig.", "Die HU/AU für … ist im März 2027 fällig." A custom
 * item is named by the owner's own title (it only ever reaches its owner).
 */
final class MaintenanceTexts
{
    /** 1 mile in km. */
    private const KM_PER_MILE = 1.609344;

    /**
     * @param  array<string, mixed>  $data  notification data (item_type, kind, due_on, due_km, lead_days, title)
     */
    public function sentence(array $data, string $vehicle, User $owner, string $locale): string
    {
        $type = MaintenanceType::tryFrom(is_string($data['item_type'] ?? null) ? $data['item_type'] : '') ?? MaintenanceType::Custom;
        $due = is_string($data['due_on'] ?? null) ? CarbonImmutable::parse($data['due_on']) : null;
        $title = is_string($data['title'] ?? null) && $data['title'] !== '' ? $data['title'] : (string) __('enums.maintenance_type.custom', [], $locale);
        $item = $type === MaintenanceType::Custom
            ? (string) __('notifications.maintenance_due.custom', ['title' => $title], $locale)
            : (string) __('notifications.maintenance_due.items.'.$type->value, [], $locale);

        if (($data['kind'] ?? null) === 'km' && is_int($data['due_km'] ?? null)) {
            return (string) __('notifications.maintenance_due.km', ['item' => $item, 'vehicle' => $vehicle, 'km' => $this->distance($data['due_km'], $owner, $locale)], $locale);
        }

        if ($due === null) {
            return (string) __('notifications.maintenance_due.undated', ['item' => $item, 'vehicle' => $vehicle], $locale);
        }

        $date = $due->settings(['locale' => $locale])->isoFormat($locale === 'de' ? 'D. MMMM YYYY' : 'D MMMM YYYY');

        return match ($type) {
            MaintenanceType::HuAu => (string) __('notifications.maintenance_due.hu_au', ['vehicle' => $vehicle, 'month' => NotificationTexts::month($due->format('Y-m'), $locale)], $locale),
            MaintenanceType::TyreChange => (string) __('notifications.maintenance_due.tyres_'.($due->month === 10 ? 'winter' : 'summer'), ['vehicle' => $vehicle, 'date' => $date], $locale),
            MaintenanceType::Insurance => (string) __('notifications.maintenance_due.insurance', ['vehicle' => $vehicle, 'date' => $date], $locale),
            default => ($data['lead_days'] ?? null) === 0
                ? (string) __('notifications.maintenance_due.today', ['item' => $item, 'vehicle' => $vehicle], $locale)
                : (string) __('notifications.maintenance_due.date', ['item' => $item, 'vehicle' => $vehicle, 'date' => $date], $locale),
        };
    }

    /**
     * "120.000 km" or "74.565 mi" (SET-11), with a no-break space before the unit.
     */
    public function distance(int $km, User $owner, string $locale): string
    {
        $miles = $owner->getAttribute('distance_unit') === DistanceUnit::Mi;
        $value = $miles ? (int) round($km / self::KM_PER_MILE) : $km;

        return Units::formatNumber($value, $locale, 0)."\u{00A0}".($miles ? 'mi' : 'km');
    }
}
