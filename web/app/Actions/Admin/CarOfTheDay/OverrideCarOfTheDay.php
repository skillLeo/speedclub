<?php

namespace App\Actions\Admin\CarOfTheDay;

use App\Enums\CarOfTheDaySource;
use App\Enums\GiftEvent;
use App\Models\CarOfTheDay;
use App\Models\Staff;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\Admin\Members\StaffAtoms;
use App\Services\Audit\Audit;
use App\Services\CarOfTheDay\CarOfTheDayClock;
use App\Services\CarOfTheDay\PublishCarOfTheDay;
use App\Services\Discover\VisibleBuilds;
use App\Services\Home\BuildOfWeek;
use App\Services\Notifications\Notifier;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Admin Car of the Day (m5.9d contract §3): staff choose the car of a day (the day Home shows now, which is yesterday's before 18:00,
 * or any later day; CR-P5G-03) with a reason; atom `content.edit`, audited with before and after. The car must be a public build any
 * guest may see in a list (not ghost, private, unlisted, a suspended owner's), never a sample in production; the score and photo
 * minimums of the automatic pick do not bind staff. CarOfTheDays::publish checks the car again when the day goes live (SEC-P5G-02).
 *
 * A day that is live already (CR-P5G-04) shows the new car at once: the previous car's notifications of that day go (its owner's and the
 * opt-in members'), and after the commit PublishCarOfTheDay tells the new car's owner and the opt-in members right away.
 */
final class OverrideCarOfTheDay
{
    public function __construct(
        private readonly VisibleBuilds $builds,
        private readonly Notifier $notifier,
    ) {}

    public function handle(Staff $staff, string $day, string $vehicleId, string $reason): CarOfTheDay
    {
        StaffAtoms::ensure($staff, 'content.edit');
        $day = self::day($day);
        $vehicle = Vehicle::query()->find($vehicleId);

        if (! $vehicle instanceof Vehicle || ! $this->builds->query(null, fromSearch: false)->where('vs.vehicle_id', $vehicle->id)->exists()) {
            throw ValidationException::withMessages(['vehicle_id' => [(string) __('validation.exists', ['attribute' => 'vehicle_id'])]]);
        }

        $owner = User::query()->findOrFail($vehicle->owner_id);
        $sample = $vehicle->getAttribute('is_sample') === true || $owner->getAttribute('is_sample') === true;

        if ($sample && app()->environment('production')) {
            throw ValidationException::withMessages(['vehicle_id' => [(string) __('validation.exists', ['attribute' => 'vehicle_id'])]]);
        }

        return DB::transaction(function () use ($staff, $day, $vehicle, $owner, $sample, $reason): CarOfTheDay {
            $row = CarOfTheDay::query()->where('day', $day)->lockForUpdate()->first() ?? new CarOfTheDay(['day' => $day]);
            $before = $row->exists ? self::snapshot($row) : null;
            // The same car chosen again keeps its rows (the grouped rows tell nobody twice).
            $previous = $row->published_at !== null && $row->vehicle_id !== null && $row->vehicle_id !== $vehicle->id ? (string) $row->vehicle_id : null;
            $published = $row->published_at !== null || $day === CarOfTheDayClock::shownDay();

            $row->forceFill([
                'vehicle_id' => $vehicle->id,
                'story_line' => BuildOfWeek::quote($vehicle),
                'bundesland' => $owner->getAttribute('bundesland'),
                'source' => CarOfTheDaySource::Staff,
                'is_sample' => $sample,
                'skipped' => false,
                'skipped_reason' => null,
                'decided_by' => $staff->getKey(),
                'picked_at' => now(),
                'published_at' => $published ? now() : null,
                'notified_at' => null,
            ])->save();

            if ($previous !== null) {
                $this->notifier->forgetCarOfTheDay($day, $previous);
            }

            Audit::record(GiftEvent::CarOfTheDayOverridden->value, $row, $before, self::snapshot($row), trim($reason), $staff);

            if ($published) {
                DB::afterCommit(fn () => PublishCarOfTheDay::dispatch($day));
            }

            return $row;
        });
    }

    /**
     * The day Home shows now (CarOfTheDayClock::shownDay: yesterday's pick before 18:00) or a later Berlin day, as Y-m-d.
     */
    public static function day(string $day): string
    {
        $parsed = preg_match('/\A\d{4}-\d{2}-\d{2}\z/', $day) === 1 ? CarbonImmutable::createFromFormat('!Y-m-d', $day, config()->string('speedclub.car_of_the_day.timezone')) : null;
        $earliest = CarOfTheDayClock::shownDay();

        if (! $parsed instanceof CarbonImmutable || $parsed->toDateString() < $earliest) {
            throw ValidationException::withMessages(['day' => [(string) __('validation.after_or_equal', ['attribute' => 'day', 'date' => $earliest])]]);
        }

        return $parsed->toDateString();
    }

    /**
     * @return array<string, mixed>
     */
    public static function snapshot(CarOfTheDay $row): array
    {
        return [
            'day' => $row->dayString(),
            'vehicle_id' => $row->vehicle_id,
            'source' => $row->source->value,
            'skipped' => $row->skipped,
            'published' => $row->published_at !== null,
        ];
    }
}
