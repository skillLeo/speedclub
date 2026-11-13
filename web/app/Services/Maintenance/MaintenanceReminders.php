<?php

namespace App\Services\Maintenance;

use App\Models\MaintenanceItem;
use App\Models\MaintenanceReminder;
use App\Models\User;
use App\Services\AppConfig\FeatureFlags;
use App\Services\Garage\HuAuReminders;
use App\Services\Notifications\Notifier;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Collection;
use Throwable;

/**
 * Maintenance reminders (09 §8.8): the server is the source of truth. Daily at 09:00 Europe/Berlin (maintenance:reminders) every enabled
 * item of a member's real (not sample, not deleted) vehicle is checked against its stages:
 *
 * - a date stage per lead time, "mnt:{item}:d{due}:{lead}", fires on due − lead days and may still go out until the item is overdue;
 *   when several have fired (a missed run, an item entered late) only the shortest goes out and the longer ones are recorded as passed
 *   over (sent_at null);
 * - one km stage per due mileage, "mnt:{item}:k{km}", once the vehicle's odometer is within MaintenanceSchedule::SOON_KM of it.
 *
 * A stage is claimed by inserting its key into maintenance_reminders (unique) before anything is sent, so it is told once, however often
 * the job runs. The keys are the contract with the app: it schedules its local backup notifications with the same ids (from
 * `GET me/maintenance/reminders`), and drops one as soon as a push with that `reminder_key` arrives or a sync says `sent`.
 * A new due date (a new log entry, an edited item) makes new keys. Bounded by time; the rest waits a day.
 *
 * While the `maintenance` flag is off, the M2.7 HU/AU reminder (HuAuReminders, sig.hu_au_reminder) runs instead.
 */
final class MaintenanceReminders
{
    public const FLAG = 'maintenance';

    /** When the daily run sends (Europe/Berlin): routes/console.php and the fire_at of the reminder plan. */
    public const HOUR = '09:00';

    private const MAX_SECONDS = 40;

    public function __construct(
        private readonly FeatureFlags $flags,
        private readonly Notifier $notifier,
        private readonly MaintenanceSchedule $schedule,
        private readonly HuAuReminders $legacy,
    ) {}

    public static function dateKey(MaintenanceItem $item, CarbonImmutable $due, int $lead): string
    {
        return 'mnt:'.$item->id.':d'.$due->toDateString().':'.$lead;
    }

    public static function kmKey(MaintenanceItem $item, int $km): string
    {
        return 'mnt:'.$item->id.':k'.$km;
    }

    /**
     * @return int|null reminders sent; null while both this and the HU/AU reminder are off
     */
    public function run(?CarbonImmutable $today = null): ?int
    {
        if (! $this->flags->enabled(self::FLAG)) {
            return $this->legacy->run($today === null ? null : CarbonImmutable::parse($today->toDateString(), config()->string('speedclub.notifications.timezone')));
        }

        $today = $today === null ? MaintenanceSchedule::today() : MaintenanceSchedule::day($today->toDateString());
        $started = microtime(true);
        $sent = 0;

        $this->candidates($today)->chunkById(200, function (Collection $items) use ($today, $started, &$sent): bool {
            foreach ($items as $item) {
                if (microtime(true) - $started > self::MAX_SECONDS) {
                    return false;
                }

                try {
                    $sent += $this->remind($item, $today);
                } catch (Throwable $exception) {
                    report($exception);
                }
            }

            return true;
        }, 'maintenance_items.id', 'id');

        return $sent;
    }

    /**
     * Every stage of the item's current due date and mileage, with what became of it: `sent`, `skipped` (passed over or missed), or
     * `planned` (fires today or later). The app schedules local notifications for the planned date stages only.
     *
     * @return list<array{key: string, kind: 'date'|'km', due_on: string|null, due_km: int|null, lead_days: int|null, fire_on: string|null, status: 'planned'|'sent'|'skipped'}>
     */
    public function stages(MaintenanceItem $item, ?CarbonImmutable $today = null): array
    {
        $today ??= MaintenanceSchedule::today();
        $stages = [];
        $due = $item->next_due_at;

        if ($due !== null) {
            foreach ($item->leadDays() as $lead) {
                $stages[] = ['key' => self::dateKey($item, $due, $lead), 'kind' => 'date', 'due_on' => $due->toDateString(), 'due_km' => null, 'lead_days' => $lead, 'fire_on' => $due->subDays($lead)->toDateString()];
            }
        }

        if ($item->next_due_km !== null) {
            $stages[] = ['key' => self::kmKey($item, $item->next_due_km), 'kind' => 'km', 'due_on' => null, 'due_km' => $item->next_due_km, 'lead_days' => null, 'fire_on' => null];
        }

        $handled = $stages === [] ? collect() : MaintenanceReminder::query()->whereIn('reminder_key', array_column($stages, 'key'))->pluck('sent_at', 'reminder_key');

        return array_map(function (array $stage) use ($handled, $today): array {
            $status = match (true) {
                $handled->has($stage['key']) => $handled->get($stage['key']) === null ? 'skipped' : 'sent',
                $stage['fire_on'] !== null && $stage['fire_on'] < $today->toDateString() => 'skipped',
                default => 'planned',
            };

            return [...$stage, 'status' => $status];
        }, $stages);
    }

    /**
     * Whether the item reminds at all: switched on, the member's SET-23 switch for its type on, on a real vehicle of an active member.
     */
    public function active(MaintenanceItem $item, ?User $owner): bool
    {
        return $item->enabled && $owner !== null && MaintenancePrefs::allows($owner, $item->type->preference());
    }

    /**
     * @return Builder<MaintenanceItem>
     */
    private function candidates(CarbonImmutable $today): Builder
    {
        $maxLead = MaintenancePrefs::MAX_LEAD_DAYS;

        return MaintenanceItem::query()
            ->select('maintenance_items.*')
            ->join('vehicles', 'vehicles.id', '=', 'maintenance_items.vehicle_id')
            ->join('users', 'users.id', '=', 'vehicles.owner_id')
            ->whereNull('vehicles.deleted_at')
            ->where('vehicles.is_sample', false)
            ->where('users.is_sample', false)
            ->whereNull('users.deleted_at')
            ->where('maintenance_items.enabled', true)
            ->where(fn (Builder $due) => $due
                // Overdue HU/AU months stay remindable to their end (deadline); other dates up to the day.
                ->whereBetween('maintenance_items.next_due_at', [$today->subDays(31)->toDateString(), $today->addDays($maxLead)->toDateString()])
                ->orWhere(fn (Builder $km) => $km->whereNotNull('maintenance_items.next_due_km')->whereNotNull('vehicles.odometer_km')
                    ->whereRaw('vehicles.odometer_km + ? >= maintenance_items.next_due_km', [MaintenanceSchedule::SOON_KM])))
            ->with(['vehicle.owner', 'vehicle.make', 'vehicle.vehicleModel', 'vehicle.generation']);
    }

    /**
     * @return int 0, 1 or 2 (a date and a km reminder on the same day)
     */
    private function remind(MaintenanceItem $item, CarbonImmutable $today): int
    {
        $vehicle = $item->vehicle;
        $owner = $vehicle->owner;

        if (! $owner instanceof User || ! $owner->isActive() || ! $this->active($item, $owner)) {
            return 0;
        }

        $sent = 0;
        $deadline = $this->schedule->deadline($item);
        $due = $item->next_due_at;

        if ($due !== null && $deadline !== null && $today->lessThanOrEqualTo($deadline)) {
            $fired = array_values(array_filter($item->leadDays(), fn (int $lead): bool => $due->subDays($lead)->lessThanOrEqualTo($today)));

            if ($fired !== []) {
                $lead = min($fired);

                foreach ($fired as $passed) {
                    if ($passed !== $lead) {
                        $this->claim($item, $owner, self::dateKey($item, $due, $passed), ['due_on' => $due->toDateString(), 'lead_days' => $passed], false);
                    }
                }

                $key = self::dateKey($item, $due, $lead);

                if ($this->claim($item, $owner, $key, ['due_on' => $due->toDateString(), 'lead_days' => $lead], true)) {
                    $sent += $this->notifier->maintenanceDue($owner, $vehicle, $item, ['key' => $key, 'kind' => 'date', 'due_on' => $due->toDateString(), 'due_km' => null, 'lead_days' => $lead]) !== null ? 1 : 0;
                }
            }
        }

        $odometer = $vehicle->getAttribute('odometer_km');

        if ($item->next_due_km !== null && is_int($odometer) && $odometer + MaintenanceSchedule::SOON_KM >= $item->next_due_km) {
            $key = self::kmKey($item, $item->next_due_km);

            if ($this->claim($item, $owner, $key, ['due_km' => $item->next_due_km], true)) {
                $sent += $this->notifier->maintenanceDue($owner, $vehicle, $item, ['key' => $key, 'kind' => 'km', 'due_on' => null, 'due_km' => $item->next_due_km, 'lead_days' => null]) !== null ? 1 : 0;
            }
        }

        return $sent;
    }

    /**
     * @param  array<string, mixed>  $attributes
     */
    private function claim(MaintenanceItem $item, User $owner, string $key, array $attributes, bool $send): bool
    {
        return MaintenanceReminder::query()->insertOrIgnore([
            'item_id' => $item->id,
            'user_id' => $owner->id,
            'reminder_key' => $key,
            'due_on' => null,
            'due_km' => null,
            'lead_days' => null,
            ...$attributes,
            'sent_at' => $send ? now() : null,
            'created_at' => now(),
        ]) === 1;
    }
}
