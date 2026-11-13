<?php

namespace App\Services\Showcase;

use App\Enums\MaintenanceType;
use App\Models\MaintenanceItem;
use App\Models\MaintenanceLog;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\Maintenance\MaintenanceItems;
use App\Services\Maintenance\MaintenanceSchedule;
use Carbon\CarbonImmutable;

/**
 * Sample maintenance of the showcase (09 §8.19, M4.13): the main build of the showcase member (Showcase::SHOWCASE_USERNAME, who signs in
 * for the review, so MNT-01 has content) and the first build of the SPEED CLUB Editorial account get HU/AU, oil, brake fluid, tyres,
 * insurance and a few service log entries with costs at a "Beispiel-Werkstatt". Maintenance is owner-only, so nobody else ever sees it;
 * sample vehicles never send reminders (MaintenanceReminders). Fixed ids (so screenshots stay comparable) and dates from now; seeding again
 * rewrites the same rows. Removed with the vehicles (`speedclub:demo --purge`, foreign keys).
 */
class ShowcaseMaintenance
{
    public function __construct(private readonly MaintenanceItems $items) {}

    /**
     * @return int items written
     */
    public function seed(?CarbonImmutable $today = null): int
    {
        Showcase::assertEnvironment('ShowcaseMaintenance');
        $today ??= MaintenanceSchedule::today();
        $written = 0;

        foreach ([Showcase::SHOWCASE_USERNAME, ShowcaseEvents::EDITORIAL] as $username) {
            $owner = User::query()->where('username', $username)->where('is_sample', true)->first();
            $vehicle = $owner instanceof User
                ? Vehicle::query()->where('owner_id', $owner->id)->orderByDesc('is_main')->orderBy('sort')->orderBy('id')->first()
                : null;

            if ($vehicle instanceof Vehicle) {
                $written += $this->seedVehicle($vehicle, $today);
            }
        }

        return $written;
    }

    /**
     * A ULID that is the same on every seed for one key: "01JM" and 22 hex digits, valid Crockford base32.
     */
    public static function id(string $key): string
    {
        return strtolower('01JM'.substr(hash('sha256', 'showcase-maintenance:'.$key), 0, 22));
    }

    private function seedVehicle(Vehicle $vehicle, CarbonImmutable $today): int
    {
        $key = $vehicle->public_id;
        $odometer = 48_200;
        $vehicle->forceFill(['odometer_km' => $odometer, 'odometer_at' => $today->subDays(3)])->save();

        $items = [
            'hu_au' => [MaintenanceType::HuAu, ['next_due_at' => $today->addDays(45)->startOfMonth()->toDateString(), 'due_pinned' => true, 'interval_months' => 24, 'lead_days' => [30, 14, 1]]],
            'oil' => [MaintenanceType::OilChange, ['interval_months' => 12, 'interval_km' => 15000, 'last_done_at' => $today->subMonths(11)->subDays(20)->toDateString(), 'last_done_km' => 34_500, 'lead_days' => [14]]],
            'brake' => [MaintenanceType::BrakeFluid, ['interval_months' => 24, 'last_done_at' => $today->subMonths(9)->toDateString(), 'lead_days' => [14]]],
            'tyres' => [MaintenanceType::TyreChange, ['last_done_at' => $today->subMonths(5)->toDateString(), 'lead_days' => [14]]],
            'insurance' => [MaintenanceType::Insurance, ['lead_days' => [29]]],
        ];

        foreach ($items as $name => [$type, $attributes]) {
            $item = MaintenanceItem::query()->find(self::id($key.':'.$name)) ?? new MaintenanceItem;
            $item->forceFill([
                'id' => self::id($key.':'.$name),
                'vehicle_id' => $vehicle->id,
                'type' => $type,
                'slot' => $type->value,
                'title' => null,
                'interval_months' => null,
                'interval_km' => null,
                'last_done_at' => null,
                'last_done_km' => null,
                'next_due_at' => null,
                'next_due_km' => null,
                'due_pinned' => false,
                'enabled' => true,
                'notes' => null,
                'version' => 1,
                ...$attributes,
            ]);
            // Another seed run (or the member's own HU/AU) may hold the slot already: that row is replaced by this one.
            MaintenanceItem::query()->where('vehicle_id', $vehicle->id)->where('slot', $type->value)->whereKeyNot($item->id)->delete();
            $item->setRelation('vehicle', $vehicle);
            $this->items->refresh($item);
            $item->save();
        }

        $logs = [
            'oil' => ['oil', $today->subMonths(11)->subDays(20), 34_500, 18_900, 'Öl 5W-30 und Filter neu. (Beispiel)'],
            'brake' => ['brake', $today->subMonths(9), 38_100, 9_450, 'Bremsflüssigkeit DOT 4 gewechselt. (Beispiel)'],
            'tyres' => ['tyres', $today->subMonths(5), 42_700, 4_000, 'Sommerräder montiert, Luftdruck geprüft. (Beispiel)'],
        ];

        foreach ($logs as $name => [$itemName, $done, $km, $cents, $notes]) {
            $item = MaintenanceItem::query()->findOrFail(self::id($key.':'.$itemName));
            $log = MaintenanceLog::query()->find(self::id($key.':log:'.$name)) ?? new MaintenanceLog;
            $log->forceFill([
                'id' => self::id($key.':log:'.$name),
                'vehicle_id' => $vehicle->id,
                'item_id' => $item->id,
                'type' => $item->type,
                'done_at' => $done->toDateString(),
                'mileage_km' => $km,
                'workshop' => 'Beispiel-Werkstatt Nord',
                'cost_cents' => $cents,
                'currency' => 'EUR',
                'notes' => $notes,
                'version' => 1,
            ])->save();
        }

        return count($items);
    }
}
