<?php

namespace App\Services\Garage;

use App\Models\Vehicle;
use App\Services\AppConfig\FeatureFlags;
use App\Services\Notifications\Notifier;
use Carbon\CarbonImmutable;
use Throwable;

/**
 * [SIG sig.hu_au_reminder] The HU/AU reminder of 02_PRODUCT_SPEC §5 and §7 (M2.7): 30 days before the month the HU/AU is due starts, the
 * owner gets the `hu_au_reminder` row, a push (on by default) and, when switched on, an e-mail. Daily at 09:00 Europe/Berlin
 * (vehicles:hu-au-reminders).
 *
 * Once per due date: vehicles.hu_au_reminded_for holds the due month the reminder went out for, claimed by a conditional update before
 * anything is sent. A run that was missed catches up until the due month ends; a due month entered inside the window is reminded at the
 * next run; an overdue one (a month already over) is not. A new due date gets its own reminder. Bounded by time; the rest waits a day.
 *
 * M4.13: while the `maintenance` flag is on, the HU/AU is a maintenance item and App\Services\Maintenance\MaintenanceReminders tells it
 * (30/14/1 days, SET-23); this one then stays silent, so nobody hears about one HU/AU twice.
 */
final class HuAuReminders
{
    public const DAYS_BEFORE = 30;

    private const MAX_SECONDS = 40;

    public function __construct(
        private readonly FeatureFlags $flags,
        private readonly Notifier $notifier,
    ) {}

    /**
     * @return int|null how many reminders went out, null while the flag is off (or `maintenance` is on)
     */
    public function run(?CarbonImmutable $today = null): ?int
    {
        if (! $this->flags->enabled('sig.hu_au_reminder') || $this->flags->enabled('maintenance')) {
            return null;
        }

        $today = ($today ?? CarbonImmutable::now(config()->string('speedclub.notifications.timezone')))->startOfDay();
        $started = microtime(true);
        $sent = 0;

        $vehicles = Vehicle::query()
            ->whereNotNull('hu_au_due')
            ->where('hu_au_due', '>=', $today->startOfMonth()->toDateString())
            ->where('hu_au_due', '<=', $today->addDays(self::DAYS_BEFORE)->toDateString())
            ->where(fn ($query) => $query->whereNull('hu_au_reminded_for')->orWhereColumn('hu_au_reminded_for', '<>', 'hu_au_due'))
            ->with('owner', 'make', 'vehicleModel', 'generation')
            ->orderBy('id')
            ->get();

        foreach ($vehicles as $vehicle) {
            if (microtime(true) - $started > self::MAX_SECONDS) {
                break;
            }

            try {
                if ($this->remind($vehicle)) {
                    $sent++;
                }
            } catch (Throwable $exception) {
                report($exception);
            }
        }

        return $sent;
    }

    private function remind(Vehicle $vehicle): bool
    {
        $due = $vehicle->getAttribute('hu_au_due');
        $owner = $vehicle->owner;

        if (! $due instanceof \DateTimeInterface || $owner === null) {
            return false;
        }

        $day = $due->format('Y-m-d');
        $claimed = Vehicle::query()
            ->whereKey($vehicle->id)
            ->where('hu_au_due', $day)
            ->where(fn ($query) => $query->whereNull('hu_au_reminded_for')->orWhere('hu_au_reminded_for', '<>', $day))
            ->toBase()
            ->update(['hu_au_reminded_for' => $day]);

        return $claimed === 1 && $this->notifier->huAuReminder($owner, $vehicle, $due->format('Y-m')) !== null;
    }
}
