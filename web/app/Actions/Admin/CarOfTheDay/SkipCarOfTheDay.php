<?php

namespace App\Actions\Admin\CarOfTheDay;

use App\Enums\CarOfTheDaySource;
use App\Enums\GiftEvent;
use App\Models\CarOfTheDay;
use App\Models\Staff;
use App\Services\Admin\Members\StaffAtoms;
use App\Services\Audit\Audit;
use App\Services\Notifications\Notifier;
use Illuminate\Support\Facades\DB;

/**
 * Admin Car of the Day: no car on a day (the day Home shows now, which is yesterday's before 18:00, or a later day; CR-P5G-03) with a
 * reason; atom `content.edit`, audited. A skipped day keeps its row, so the 17:55 job picks nothing for it and Home shows no Car of the
 * Day until the next published one; skipping the live day empties Home at once (CarOfTheDays::current) and takes that day's
 * notifications of the car out of every list (CR-P5G-04).
 */
final class SkipCarOfTheDay
{
    public function __construct(private readonly Notifier $notifier) {}

    public function handle(Staff $staff, string $day, string $reason): CarOfTheDay
    {
        StaffAtoms::ensure($staff, 'content.edit');
        $day = OverrideCarOfTheDay::day($day);

        return DB::transaction(function () use ($staff, $day, $reason): CarOfTheDay {
            $row = CarOfTheDay::query()->where('day', $day)->lockForUpdate()->first() ?? new CarOfTheDay(['day' => $day]);
            $before = $row->exists ? OverrideCarOfTheDay::snapshot($row) : null;
            $previous = $row->published_at !== null && $row->vehicle_id !== null && ! $row->skipped ? (string) $row->vehicle_id : null;

            $row->forceFill([
                'vehicle_id' => null,
                'story_line' => null,
                'bundesland' => null,
                'source' => CarOfTheDaySource::Staff,
                'is_sample' => false,
                'skipped' => true,
                'skipped_reason' => mb_substr(trim($reason), 0, 500),
                'decided_by' => $staff->getKey(),
                'picked_at' => now(),
                'published_at' => null,
                'notified_at' => null,
            ])->save();

            if ($previous !== null) {
                $this->notifier->forgetCarOfTheDay($day, $previous);
            }

            Audit::record(GiftEvent::CarOfTheDaySkipped->value, $row, $before, OverrideCarOfTheDay::snapshot($row), trim($reason), $staff);

            return $row;
        });
    }
}
