<?php

namespace App\Services\CarOfTheDay;

use App\Enums\GiftEvent;
use App\Enums\OnboardingState;
use App\Enums\UserStatus;
use App\Http\Resources\V1\FeedVehicleResource;
use App\Models\CarOfTheDay;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\Audit\Audit;
use App\Services\Discover\VisibleBuilds;
use App\Services\Notifications\Notifier;
use Carbon\CarbonImmutable;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * The Car of the Day after its pick (m5.9d contract §3, ADR-510): publication at 18:00 with the owner's notification and the opt-in
 * push, what Home shows (from 18:00 to the next day's 18:00, for the reader: blocks, ghost, private, hidden samples) and whether a car is
 * featured right now (the owner's story editor).
 *
 * SEC-P5G-02: the car is checked again when it is published and before every chunk of the fan-out (eligible()): an owner who switched
 * on Ghost mode, made the car private, or was suspended between the pick (17:55, or a staff choice days ahead) and 18:00 is never
 * announced. Such a pick is withdrawn (withdraw(): skipped, reason `auto_withdrawn`, audited, logged, notifications already written
 * removed) and the day stays empty: no second pick, so nobody is told about a car that was chosen in a hurry, and staff can still
 * choose one in ADM (OverrideCarOfTheDay).
 */
final class CarOfTheDays
{
    public function __construct(
        private readonly VisibleBuilds $builds,
        private readonly Notifier $notifier,
    ) {}

    /**
     * The published pick on Home now, regardless of the reader.
     */
    public function current(?CarbonImmutable $now = null): ?CarOfTheDay
    {
        $row = CarOfTheDay::query()
            ->where('day', CarOfTheDayClock::shownDay($now))
            ->whereNotNull('published_at')
            ->where('skipped', false)
            ->whereNotNull('vehicle_id')
            ->first();

        return $row instanceof CarOfTheDay ? $row : null;
    }

    /**
     * The pick and its car for this reader, or null when there is none or the reader may not see the car in a list. $now is the read's
     * moment (the QA clock outside production, DQ-P5-201); null is the real now.
     *
     * @return array{pick: CarOfTheDay, vehicle: Vehicle}|null
     */
    public function shownTo(?User $viewer, ?CarbonImmutable $now = null): ?array
    {
        $pick = $this->current($now);

        if ($pick === null || ! $this->builds->query($viewer, fromSearch: false)->where('vs.vehicle_id', $pick->vehicle_id)->exists()) {
            return null;
        }

        $vehicle = Vehicle::query()->whereKey($pick->vehicle_id)->with(FeedVehicleResource::RELATIONS)->withCount('modifications')->first();

        return $vehicle instanceof Vehicle ? ['pick' => $pick, 'vehicle' => $vehicle] : null;
    }

    /**
     * Whether $vehicle is the pick on Home right now.
     */
    public function isFeatured(Vehicle $vehicle): bool
    {
        return $this->current()?->vehicle_id === $vehicle->id;
    }

    /** skipped_reason of a pick the system took back because its car may no longer be listed. */
    public const WITHDRAWN = 'auto_withdrawn';

    /**
     * Whether the pick's car may (still) be the Car of the Day: a public build any guest may see in a list (VisibleBuilds: published,
     * public, not ghost, not hidden by moderation, owner active and verified, samples only while they are shown), never a sample in
     * production.
     */
    public function eligible(CarOfTheDay $pick): bool
    {
        if ($pick->vehicle_id === null) {
            return false;
        }

        $row = $this->builds->query(null, fromSearch: false)->where('vs.vehicle_id', $pick->vehicle_id)->first(['v.is_sample as vehicle_sample', 'u.is_sample as owner_sample']);

        if ($row === null) {
            return false;
        }

        return ! (app()->environment('production') && ($pick->is_sample || (bool) $row->vehicle_sample || (bool) $row->owner_sample));
    }

    /**
     * Takes an ineligible pick off its day for good (see the class doc): Home shows nothing for the day, nobody else is told, and what
     * was written already goes.
     */
    public function withdraw(CarOfTheDay $pick): void
    {
        $withdrawn = DB::transaction(function () use ($pick): ?CarOfTheDay {
            $row = CarOfTheDay::query()->whereKey($pick->getKey())->lockForUpdate()->first();

            if (! $row instanceof CarOfTheDay || $row->skipped) {
                return null;
            }

            $before = ['vehicle_id' => $row->vehicle_id, 'skipped' => false, 'published' => $row->published_at !== null];
            $row->forceFill(['skipped' => true, 'skipped_reason' => self::WITHDRAWN])->save();
            Audit::record(GiftEvent::CarOfTheDayWithdrawn->value, $row, $before, ['vehicle_id' => $row->vehicle_id, 'skipped' => true], self::WITHDRAWN);

            return $row;
        }, 3);

        if ($withdrawn === null) {
            return;
        }

        Cache::forget('car_of_the_day:fanout:'.$withdrawn->dayString().':'.$withdrawn->vehicle_id);
        $this->notifier->forgetCarOfTheDay($withdrawn->dayString(), (string) $withdrawn->vehicle_id);
        Log::warning('Car of the Day withdrawn: the car may no longer be listed (ghost, private, hidden, owner inactive or a sample).', [
            'day' => $withdrawn->dayString(),
            'vehicle_id' => $withdrawn->vehicle_id,
        ]);
    }

    /**
     * Publishes the day's pick (once) and tells people: the owner always (in-app; push by their switch), the members who opted in to
     * "Car of the Day" in chunks until `seconds` are used (resumable: a cursor in the cache; notified_at when done). A sample pick is
     * shown but told to nobody. Returns whether the day is fully told.
     */
    public function publish(string $day): bool
    {
        $pick = CarOfTheDay::query()->where('day', $day)->where('skipped', false)->whereNotNull('vehicle_id')->first();

        if (! $pick instanceof CarOfTheDay) {
            return true;
        }

        if (! $this->eligible($pick)) {
            $this->withdraw($pick);

            return true;
        }

        if ($pick->published_at === null) {
            $pick->forceFill(['published_at' => now()])->save();
        }

        if ($pick->notified_at !== null) {
            return true;
        }

        $vehicle = Vehicle::query()->find($pick->vehicle_id);
        $owner = $vehicle instanceof Vehicle ? User::query()->find($vehicle->owner_id) : null;

        if (! $vehicle instanceof Vehicle || ! $owner instanceof User || $pick->is_sample || $owner->getAttribute('is_sample') === true) {
            $pick->forceFill(['notified_at' => now()])->save();

            return true;
        }

        $this->notifier->carOfTheDayOwner($owner, $vehicle, $day);

        $key = 'car_of_the_day:fanout:'.$day.':'.$vehicle->id;
        $cursor = Cache::get($key);
        $deadline = microtime(true) + config()->integer('speedclub.car_of_the_day.seconds');
        $chunk = max(1, config()->integer('speedclub.car_of_the_day.fanout_chunk'));

        while (true) {
            // The owner may say "no" while a fan-out resumes over several runs.
            if (! $this->eligible($pick)) {
                $this->withdraw($pick);

                return true;
            }

            $ids = $this->optedIn($owner)
                ->when(is_string($cursor), fn (Builder $query) => $query->where('u.id', '>', $cursor))
                ->orderBy('u.id')
                ->limit($chunk)
                ->pluck('u.id')
                ->map(strval(...))
                ->all();

            foreach (User::query()->whereKey($ids)->get() as $member) {
                $this->notifier->carOfTheDay($member, $vehicle, $day);
            }

            if (count($ids) < $chunk) {
                Cache::forget($key);
                $pick->forceFill(['notified_at' => now()])->save();

                return true;
            }

            $cursor = end($ids);
            Cache::put($key, $cursor, now()->addDays(2));

            if (microtime(true) > $deadline) {
                return false;
            }
        }
    }

    /**
     * Members who switched the opt-in on (push or browser notifications), may get pushes at all (a token or subscription), are real and
     * active, and have no block with the owner. Not the owner (who has their own row).
     */
    private function optedIn(User $owner): Builder
    {

        return DB::table('users', 'u')
            ->whereNull('u.deleted_at')
            ->where('u.status', UserStatus::Active->value)
            ->whereNotNull('u.email_verified_at')
            ->where('u.is_sample', false)
            ->where(fn (Builder $terms) => $terms->whereNull('u.onboarding_state')->orWhere('u.onboarding_state', '!=', OnboardingState::PendingTerms->value))
            ->where('u.id', '!=', $owner->id)
            ->where(fn (Builder $on) => $on
                ->whereRaw("JSON_UNQUOTE(JSON_EXTRACT(u.notification_prefs, '$.types.car_of_the_day.push')) = 'true'")
                ->orWhereRaw("JSON_UNQUOTE(JSON_EXTRACT(u.notification_prefs, '$.types.car_of_the_day.web_push')) = 'true'"))
            ->where(fn (Builder $reach) => $reach
                ->whereExists(fn (Builder $token) => $token->selectRaw('1')->from('push_tokens', 'pt')->whereColumn('pt.user_id', 'u.id'))
                ->orWhereExists(fn (Builder $sub) => $sub->selectRaw('1')->from('push_subscriptions', 'ps')->whereColumn('ps.user_id', 'u.id')))
            ->whereNotExists(fn (Builder $block) => $block->selectRaw('1')->from('blocks', 'b')
                ->where(fn (Builder $either) => $either
                    ->where(fn (Builder $mine) => $mine->whereColumn('b.blocker_id', 'u.id')->where('b.blocked_id', $owner->id))
                    ->orWhere(fn (Builder $theirs) => $theirs->where('b.blocker_id', $owner->id)->whereColumn('b.blocked_id', 'u.id'))));
    }
}
