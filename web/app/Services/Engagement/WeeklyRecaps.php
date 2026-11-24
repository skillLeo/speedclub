<?php

namespace App\Services\Engagement;

use App\Enums\RecapStatus;
use App\Jobs\Engagement\SendWeeklyRecapMail;
use App\Models\User;
use App\Models\Vehicle;
use App\Models\WeeklyRecap;
use App\Services\AppConfig\FeatureFlags;
use App\Services\Events\NearbyEvents;
use App\Services\Maintenance\MaintenanceOverview;
use App\Services\Notifications\NotificationPrefs;
use App\Services\Notifications\Notifier;
use Carbon\CarbonImmutable;
use Carbon\CarbonInterface;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Throwable;

/**
 * M5.7 weekly recap (10 §6.3, m5.7-contract §6), run by recap:weekly on Sundays every five minutes from 18:00 to 21:55 Europe/Berlin:
 * one recap per member and ISO week with the week's views, sticker scans, new followers, spots, due maintenance and Treffen near the
 * member's own home region (never a device location). Skipped when nothing happened — Treffen alone never make a recap. Push first
 * (switch weekly_recap, quiet hours, the night window and the 3-a-week engagement cap); the e-mail only when no push went out and the
 * member kept "per E-Mail" on (D-1), with a one-click unsubscribe link.
 *
 * Idempotent: the unique (user_id, week) row is inserted before anything is sent, so a member is never processed twice in a week. Members
 * in id order, the cursor in the cache per week; `weekly_recap.seconds` bound a run; a cache lock keeps two runs apart.
 *
 * @phpstan-type Payload array{views: int, sticker_scans: int, new_followers: int, spots: int, events_nearby: int, maintenance_due: int}
 */
final class WeeklyRecaps
{
    public const FLAG = 'weekly_recap';

    public const LOCK = 'recap:weekly:lock';

    public function __construct(
        private readonly Notifier $notifier,
        private readonly FeatureFlags $flags,
        private readonly NearbyEvents $events,
        private readonly MaintenanceOverview $maintenance,
    ) {}

    /**
     * @return int|null members processed, null while another run holds the lock
     */
    public function run(?CarbonImmutable $now = null): ?int
    {
        if (! $this->flags->enabled(self::FLAG)) {
            return 0;
        }

        $lock = Cache::lock(self::LOCK, 120);

        if (! $lock->get()) {
            return null;
        }

        try {
            return $this->send($now ?? CarbonImmutable::now());
        } finally {
            $lock->release();
        }
    }

    /**
     * The numbers of the member's ISO week up to $now.
     *
     * @return Payload
     */
    public function payload(User $member, CarbonImmutable $now): array
    {
        $zone = config()->string('speedclub.notifications.timezone');
        $local = $now->setTimezone($zone);
        $monday = $local->startOfWeek(CarbonInterface::MONDAY);
        $start = $monday->utc();
        $ids = Vehicle::query()->where('owner_id', $member->id)->pluck('id')->map(strval(...))->all();

        $views = (int) DB::table('view_days')->where('owner_id', $member->id)
            ->where(fn ($scope) => $scope->whereNull('vehicle_id')->orWhereIn('vehicle_id', $ids))
            ->whereBetween('day', [$monday->toDateString(), $local->toDateString()])
            ->sum('views');
        $scans = $ids === [] ? 0 : (int) DB::table('qr_scan_daily')
            ->whereIn('qr_code_id', DB::table('qr_codes')->whereIn('vehicle_id', $ids)->select('id'))
            ->whereBetween('day', [$monday->toDateString(), $local->toDateString()])
            ->sum('count');
        $followers = DB::table('follows')->where('followee_id', $member->id)->where('created_at', '>=', $start)->count()
            + ($ids === [] ? 0 : DB::table('vehicle_follows')->whereIn('vehicle_id', $ids)->where('created_at', '>=', $start)->count());
        $spots = $ids === [] ? 0 : DB::table('spots')->whereIn('vehicle_id', $ids)->where('counted', true)->whereNull('deleted_at')
            ->where('created_at', '>=', $start)->count();

        return [
            'views' => $views,
            'sticker_scans' => $scans,
            'new_followers' => $followers,
            'spots' => $spots,
            'events_nearby' => $this->eventsNearby($member, $now),
            'maintenance_due' => $this->flags->enabled('maintenance')
                ? $this->maintenance->upcoming($member, config()->integer('speedclub.weekly_recap.maintenance_days', 14), 20)->count()
                : 0,
        ];
    }

    /**
     * @param  Payload  $payload
     */
    public static function nothingHappened(array $payload): bool
    {
        return $payload['views'] === 0 && $payload['sticker_scans'] === 0 && $payload['new_followers'] === 0 && $payload['spots'] === 0
            && $payload['maintenance_due'] === 0;
    }

    private function send(CarbonImmutable $now): int
    {
        $week = $now->setTimezone(config()->string('speedclub.notifications.timezone'))->startOfWeek(CarbonInterface::MONDAY)->toDateString();
        $cursorKey = 'recap:weekly:cursor:'.$week;
        $after = Cache::get($cursorKey);
        $deadline = microtime(true) + config()->integer('speedclub.weekly_recap.seconds', 40);
        $chunk = max(1, config()->integer('speedclub.weekly_recap.chunk', 200));
        $done = 0;

        do {
            $members = $this->members(is_string($after) ? $after : null, $chunk);

            foreach ($members as $member) {
                $after = $member->id;

                try {
                    $done += $this->recap($member, $week, $now);
                } catch (Throwable $exception) {
                    report($exception);
                }

                Cache::put($cursorKey, $after, now()->addDays(3));

                if (microtime(true) > $deadline) {
                    return $done;
                }
            }
        } while (count($members) === $chunk);

        return $done;
    }

    /**
     * Real, active, verified members after $after in id order.
     *
     * @return list<User>
     */
    private function members(?string $after, int $chunk): array
    {
        /** @var Builder<User> $query */
        $query = User::query()
            ->where('is_sample', false)
            ->whereNotNull('email_verified_at')
            ->when($after !== null, fn (Builder $query) => $query->where('id', '>', $after))
            ->orderBy('id')
            ->limit($chunk);

        return array_values($query->get()->filter(fn (User $member): bool => $member->isActive())->all());
    }

    /**
     * @return int 1 when the member was processed this run
     */
    private function recap(User $member, string $week, CarbonImmutable $now): int
    {
        $prefs = NotificationPrefs::for($member)['types']['weekly_recap'] ?? [];
        $wantsPush = ($prefs['push'] ?? false) || ($prefs[NotificationPrefs::WEB_PUSH] ?? false);
        $wantsMail = $prefs['email'] ?? false;

        if (! $wantsPush && ! $wantsMail) {
            return 0;
        }

        $payload = $this->payload($member, $now);
        $skipped = self::nothingHappened($payload);

        $created = DB::table('weekly_recaps')->insertOrIgnore([
            'user_id' => $member->id,
            'week' => $week,
            'status' => ($skipped ? RecapStatus::Skipped : RecapStatus::Unreachable)->value,
            'channels' => null,
            'payload' => json_encode($payload),
            'created_at' => now(),
        ]);

        if ($created !== 1 || $skipped) {
            return $created;
        }

        $channels = [];
        $row = $this->notifier->weeklyRecap($member, $week, $payload);

        if ($row !== null && $row->refresh()->pushed_at !== null) {
            $channels[] = 'push';
        }

        if ($channels === [] && $wantsMail && $member->hasVerifiedEmail()) {
            $recapId = (int) WeeklyRecap::query()->where('user_id', $member->id)->where('week', $week)->value('id');
            SendWeeklyRecapMail::dispatch($recapId)->afterCommit();
            $channels[] = 'email';
        }

        WeeklyRecap::query()->where('user_id', $member->id)->where('week', $week)->update([
            // The in-app row is there either way; "unreachable" when neither a push nor an e-mail went out.
            'status' => ($channels === [] ? RecapStatus::Unreachable : RecapStatus::Sent)->value,
            'channels' => json_encode($channels),
        ]);

        return 1;
    }

    private function eventsNearby(User $member, CarbonImmutable $now): int
    {
        $lat = $member->getAttribute('home_region_lat');
        $lng = $member->getAttribute('home_region_lng');

        if ($lat === null || $lng === null) {
            return 0;
        }

        $until = $now->addDays(config()->integer('speedclub.weekly_recap.events_days', 7));

        return count(array_filter(
            $this->events->near($member, [(float) $lat, (float) $lng]),
            fn ($event): bool => $event->starts_at !== null && $event->starts_at->lessThanOrEqualTo($until),
        ));
    }
}
