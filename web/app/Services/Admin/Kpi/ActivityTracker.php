<?php

namespace App\Services\Admin\Kpi;

use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

/**
 * users.last_seen_at and the anonymous activity counters of ADR-216. A member counts once per German day and once per German month:
 * when last_seen_at moves into a new one, activity_days and activity_months go up by one. Otherwise last_seen_at moves at most once an
 * hour, so an active member costs one write an hour, not one per request.
 *
 * Called at sign-in (SignInMember) and on every authenticated use (AdminServiceProvider listens to Sanctum's TokenAuthenticated and
 * the session guard's Authenticated). The move is a conditional update on the value read, so two parallel requests count once.
 */
final class ActivityTracker
{
    /**
     * @param  bool  $signIn  a sign-in always moves last_seen_at, whatever the hour
     */
    public function seen(User $user, bool $signIn = false): void
    {
        $zone = config()->string('speedclub.display_timezone');
        $now = CarbonImmutable::now();
        $last = $user->getAttribute('last_seen_at');
        $last = $last === null ? null : CarbonImmutable::parse($last);

        $today = $now->setTimezone($zone);
        $newDay = $last === null || $last->setTimezone($zone)->toDateString() !== $today->toDateString();
        $newMonth = $last === null || $last->setTimezone($zone)->format('Y-m') !== $today->format('Y-m');

        if (! $signIn && ! $newDay && $last->gt($now->subHour())) {
            return;
        }

        $query = User::query()->whereKey($user->getKey());
        $last === null
            ? $query->whereNull('last_seen_at')
            : $query->where('last_seen_at', $last->utc()->format('Y-m-d H:i:s'));

        // toBase(): use alone moves no updated_at, nothing a member edited. A sign-in touches the row as it always did.
        $stamp = $now->utc()->format('Y-m-d H:i:s');
        $values = $signIn ? ['last_seen_at' => $stamp, 'updated_at' => $stamp] : ['last_seen_at' => $stamp];
        $moved = $query->toBase()->update($values);

        if ($moved !== 1 && $signIn) {
            // Another request moved it first, and counted it if a count was due; the sign-in still sets the time.
            User::query()->whereKey($user->getKey())->toBase()->update($values);
        }

        $user->setAttribute('last_seen_at', $now);
        $user->syncOriginalAttribute('last_seen_at');

        if ($moved !== 1) {
            return;
        }

        if ($newDay) {
            DB::table('activity_days')->upsert([['day' => $today->toDateString(), 'members' => 1]], ['day'], ['members' => DB::raw('members + 1')]);
        }

        if ($newMonth) {
            DB::table('activity_months')->upsert([['month' => $today->startOfMonth()->toDateString(), 'members' => 1]], ['month'], ['members' => DB::raw('members + 1')]);
        }
    }

    /**
     * The rolling seven-day count for the German day before today, stored once a day (speedclub:kpi-snapshot, 00:05). Members seen in
     * the minutes since midnight count as well; that is the price of keeping no per-member history.
     */
    public function snapshotWeekly(): int
    {
        $zone = config()->string('speedclub.display_timezone');
        $yesterday = CarbonImmutable::now($zone)->subDay()->startOfDay();
        $count = DB::table('users')
            ->whereNull('deleted_at')
            ->where('last_seen_at', '>=', $yesterday->subDays(6)->utc()->format('Y-m-d H:i:s'))
            ->count();

        DB::table('activity_days')->upsert([['day' => $yesterday->toDateString(), 'members' => 0, 'weekly' => $count]], ['day'], ['weekly']);

        return $count;
    }
}
