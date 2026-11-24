<?php

namespace App\Services\Events;

use App\Enums\EventVisibility;
use App\Enums\NotificationType;
use App\Enums\UserStatus;
use App\Http\Controllers\Web\EmailUnsubscribeController;
use App\Mail\EventNearbyMail;
use App\Models\Event;
use App\Models\Notification;
use App\Models\User;
use App\Services\Notifications\EngagementPushLimiter;
use App\Services\Notifications\NotificationPrefs;
use App\Services\Notifications\NotificationTexts;
use App\Services\Notifications\Notifier;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Database\Query\Builder as QueryBuilder;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Mail;

/**
 * M5.6 "Neue Treffen in deiner Nähe" (10 §4, m5.6-contract §6): once a week, from Thursday 18:00 Europe/Berlin, every member who switched
 * `event_nearby` on in any channel (opt-in, off by default) and chose a SET-11 home region hears about public, published, non-sample meets
 * published in the last week that start within two weeks, within nearby_radius_km of the region point (never the device's location),
 * not their own, not answered yet, not of a member with a block either way. Nothing new: nothing is sent, never "Keine neuen Treffen".
 *
 * One in-app row per member and ISO week (`event_nearby:{week}`) is the weekly cap and makes every rerun harmless; its push follows the
 * member's switch, their quiet hours and the social limit (one social push a day, never 22–08, SocialPushLimiter). A push held back by
 * quiet hours is tried again by the later runs of the window ("moves to 08:00"). The e-mail is queued with a one-click unsubscribe link.
 *
 * Shared hosting: events:nearby-digest runs every ten minutes; outside the window it returns at once. Each run stops after
 * nearby_job_seconds and resumes from the last member id of the week (cache), so a large member base spreads over several runs.
 */
class SendNearbyEventsDigest
{
    public function __construct(
        private readonly EventFeed $feed,
        private readonly Notifier $notifier,
        private readonly NotificationTexts $texts,
        private readonly EngagementPushLimiter $engagement,
    ) {}

    /**
     * The Thursday 18:00 (Berlin) that starts the window $at falls in, or null outside every window.
     */
    public function windowStart(?CarbonImmutable $at = null): ?CarbonImmutable
    {
        $zone = config()->string('speedclub.notifications.timezone');
        $now = ($at ?? CarbonImmutable::now())->setTimezone($zone);
        [$hour, $minute] = array_map(intval(...), explode(':', config()->string('speedclub.events.nearby_time')));
        $start = $now->startOfWeek(CarbonImmutable::MONDAY)->addDays(config()->integer('speedclub.events.nearby_weekday') - 1)->setTime($hour, $minute);

        return $now->gte($start) && $now->lt($start->addHours(config()->integer('speedclub.events.nearby_window_hours'))) ? $start : null;
    }

    /**
     * "2026-W47": the ISO week of a window.
     */
    public static function week(CarbonImmutable $start): string
    {
        return $start->format('o-\WW');
    }

    /**
     * @return array{due: bool, week: string|null, sent: int, pushed: int, done: bool}
     */
    public function run(?int $maxSeconds = null, bool $force = false): array
    {
        $start = $this->windowStart() ?? ($force ? CarbonImmutable::now()->setTimezone(config()->string('speedclub.notifications.timezone')) : null);

        if ($start === null) {
            return ['due' => false, 'week' => null, 'sent' => 0, 'pushed' => 0, 'done' => true];
        }

        $week = self::week($start);
        $began = microtime(true);
        $budget = $maxSeconds ?? config()->integer('speedclub.events.nearby_job_seconds');
        $cursor = 'events:nearby-digest:'.$week.':after';
        $after = (string) Cache::get($cursor, '');
        $sent = 0;
        $done = false;

        // At least one member per run, then as many as the budget allows.
        while (true) {
            $members = $this->candidates()->where('users.id', '>', $after)->orderBy('users.id')
                ->limit(config()->integer('speedclub.events.nearby_chunk'))->get();

            if ($members->isEmpty()) {
                $done = true;
                break;
            }

            foreach ($members as $member) {
                $after = $member->id;
                $sent += $this->digest($member, $week);
                Cache::put($cursor, $after, now()->addDays(8));

                if (microtime(true) - $began >= $budget) {
                    break 2;
                }
            }
        }

        return ['due' => true, 'week' => $week, 'sent' => $sent, 'pushed' => $this->retryPushes($week, $began + $budget), 'done' => $done];
    }

    /**
     * Members who may get the digest at all: active, verified, a home region, and `event_nearby` touched in their settings (it is off by
     * default, so only members who switched it on store the key; digest() reads the switches).
     *
     * @return Builder<User>
     */
    private function candidates(): Builder
    {
        return User::query()
            ->where('users.status', UserStatus::Active->value)
            ->whereNotNull('users.email_verified_at')
            ->whereNotNull('users.home_region_lat')
            ->whereNotNull('users.home_region_lng')
            ->where('users.notification_prefs', 'like', '%"event_nearby"%');
    }

    /**
     * @return int 1 when the member was told this run, else 0
     */
    public function digest(User $member, string $week): int
    {
        $channels = NotificationPrefs::for($member)['types']['event_nearby'] ?? [];
        $email = ($channels['email'] ?? false) === true;
        $push = ($channels['push'] ?? false) === true || ($channels[NotificationPrefs::WEB_PUSH] ?? false) === true;
        $point = $member->homeRegionPoint();

        if ((! $email && ! $push) || $point === null
            || Notification::query()->where('notifiable_id', $member->id)->where('group_key', 'event_nearby:'.$week)->exists()) {
            return 0;
        }

        $events = $this->events($member, $point[0], $point[1]);

        if ($events->isEmpty()) {
            return 0;
        }

        $row = $this->notifier->eventNearby($member, $week, array_values($events->map(fn (Event $event): string => $event->id)->all()));

        if ($row === null) {
            return 0;
        }

        if ($email) {
            $this->mail($member, $events);
        }

        return 1;
    }

    /**
     * The new meets around the point, soonest first (at most 50; the e-mail names nearby_mail_max).
     *
     * @return Collection<int, Event>
     */
    public function events(User $member, float $lat, float $lng): Collection
    {
        $since = now()->subDays(config()->integer('speedclub.events.nearby_new_days'));
        $query = $this->feed->listed($member)
            ->where('events.visibility', EventVisibility::Public->value)
            ->where('events.is_sample', false)
            ->where('events.organiser_id', '!=', $member->id)
            ->where('events.starts_at', '>=', now())
            ->where('events.starts_at', '<=', now()->addDays(config()->integer('speedclub.events.nearby_ahead_days')))
            ->where(fn (Builder $new) => $new->where('events.published_at', '>=', $since)
                ->orWhere(fn (Builder $q) => $q->whereNull('events.published_at')->where('events.created_at', '>=', $since)))
            ->whereNotExists(fn (QueryBuilder $answered) => $answered->selectRaw('1')->from('event_rsvps', 'nr')
                ->whereColumn('nr.event_id', 'events.id')->where('nr.user_id', $member->id)->whereNull('nr.removed_at'));

        return $this->feed->near($query, $lat, $lng, config()->integer('speedclub.events.nearby_radius_km'))
            ->orderBy('events.starts_at')->orderBy('events.id')->limit(50)->get();
    }

    /**
     * Rows of this week whose push waited (quiet hours, the social day used up): the later runs of the window try again. SF-4 (review
     * M5.6/M5.7): in id order from a cursor (kept per week; it starts over once the end is reached, so a row held back by quiet hours comes
     * round again), within the run's time budget, and only rows of members who could get a push at all (a push token or a browser
     * subscription, the switch on, the week's engagement pushes not used up).
     */
    private function retryPushes(string $week, float $deadline): int
    {
        $cursor = 'events:nearby-digest:'.$week.':retry-after';
        $after = (string) Cache::get($cursor, '');
        $chunk = max(1, config()->integer('speedclub.events.nearby_chunk'));
        $pushed = 0;

        while (microtime(true) < $deadline) {
            $rows = Notification::query()
                ->where('type', NotificationType::EventNearby->value)
                ->where('group_key', 'event_nearby:'.$week)
                ->whereNull('pushed_at')
                ->where('id', '>', $after)
                ->where(fn (Builder $device) => $device
                    ->whereExists(fn (QueryBuilder $token) => $token->selectRaw('1')->from('push_tokens')->whereColumn('push_tokens.user_id', 'notifications.notifiable_id'))
                    ->orWhereExists(fn (QueryBuilder $browser) => $browser->selectRaw('1')->from('push_subscriptions')->whereColumn('push_subscriptions.user_id', 'notifications.notifiable_id')))
                ->orderBy('id')
                ->limit($chunk)
                ->get();

            if ($rows->isEmpty()) {
                Cache::forget($cursor);
                break;
            }

            foreach ($rows as $row) {
                $after = (string) $row->id;
                Cache::put($cursor, $after, now()->addDays(8));
                $member = User::query()->find($row->getAttribute('notifiable_id'));

                if ($member instanceof User && (NotificationPrefs::wantsPush($member, 'event_nearby') || NotificationPrefs::wantsWebPush($member, 'event_nearby'))
                    && ! $this->engagement->exhausted($member)) {
                    $this->notifier->pushIfDue($row, $member);
                    $pushed += $row->refresh()->getAttribute('pushed_at') !== null ? 1 : 0;
                }

                if (microtime(true) >= $deadline) {
                    break 2;
                }
            }
        }

        return $pushed;
    }

    /**
     * @param  Collection<int, Event>  $events
     */
    private function mail(User $member, Collection $events): void
    {
        $zone = config()->string('speedclub.notifications.timezone');
        $max = config()->integer('speedclub.events.nearby_mail_max');
        $lines = array_values($events->take($max)->map(fn (Event $event): array => [
            'title' => $event->title,
            'city' => (string) ($event->city ?? ''),
            'starts_at' => $event->starts_at?->setTimezone($zone)->toIso8601String(),
            'slug' => $event->slug,
        ])->all());

        Mail::to($member->email)->locale($this->texts->locale($member))->queue(new EventNearbyMail(
            $lines,
            $events->count(),
            self::unsubscribeUrl($member),
            is_string($member->getAttribute('home_region_label')) ? $member->getAttribute('home_region_label') : null,
            // Review M5.6 NH: the queued mail asks the member's e-mail switch again when the worker sends it.
            $member->id,
        ));
    }

    /**
     * The signed link of WEB-UNSUB that switches `event_nearby.email` off: the e-mail's button (GET asks first) and its List-Unsubscribe
     * header (the mail client's one-click POST).
     */
    public static function unsubscribeUrl(User $member): string
    {
        return EmailUnsubscribeController::url('treffen', $member, config()->integer('speedclub.events.nearby_unsubscribe_days'));
    }
}
