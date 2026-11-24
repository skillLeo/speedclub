<?php

namespace App\Services\Notifications;

use App\Enums\DigestFrequency;
use App\Models\User;

/**
 * users.notification_prefs (SET-09, M2.5 screen; the API since M2.2). Stored as what the member changed, read merged over the defaults of
 * the 02_PRODUCT_SPEC §7 matrix, so a default changed later reaches everybody who never touched it.
 *
 * Phase 4 (09 §7.12 SET-09): every type has a `web_push` channel next to `push` (the member web's browser notifications, sent since
 * M4.15; the browser's permission is the opt-in, so it starts like `push`), and `digest_frequency` says how often the message
 * digest may go out (daily or weekly).
 *
 * @phpstan-type Prefs array{types: array<string, array<string, bool>>, quiet_hours: array{enabled: bool, from: string, to: string}, message_previews: bool, digest_frequency: string}
 */
final class NotificationPrefs
{
    /**
     * Type => channel => default. Push previews of messages are off by default (ADR-035).
     */
    public const TYPES = [
        'new_follower' => ['push' => true],
        'followed_published' => ['push' => false],
        'build_saved' => ['push' => false],
        'new_message' => ['push' => true, 'email_digest' => false],
        'message_request' => ['push' => true],
        'hu_au_reminder' => ['push' => true, 'email' => false],
        'qr_milestone' => ['push' => false],
        // M4.11 (09 §8.17).
        'reaction' => ['push' => true],
        'mention' => ['push' => true],
        'comment' => ['push' => true],
        'vehicle_follower' => ['push' => true],
        // M4.12 (09 §8.17): reminders 24 h and 2 h before (push, e-mail on request); review decisions, waitlist promotions, organiser
        // updates and cancellations.
        'event_reminder' => ['push' => true, 'email' => false],
        'event_update' => ['push' => true],
        // M5.9b STREET DEX (m5.9b contract §4): the grouped 3-hourly owner alert, SET-09 category "Spots" (the job is part 2).
        'spot_alert' => ['push' => true],
        // M5.9d (m5.9d contract §7, §10.6): SET-09 "Abzeichen" (in the app always, push off), "Car of the Day" (the opt-in for everybody's
        // pick, off; the owner's own pick, on) and "Einladungen" (on).
        'badge_unlocked' => ['push' => false],
        'car_of_the_day' => ['push' => false],
        'car_of_the_day_owner' => ['push' => true],
        'invite_accepted' => ['push' => true],
        // M5.8 (m5.8-contract §5): SET-09 "Forum": replies in my threads and subscriptions, mentions, my answer marked as the solution.
        'forum_reply' => ['push' => true],
        'forum_mention' => ['push' => true],
        'forum_solved' => ['push' => true],
        // M5.6 (m5.6-contract §6, 10 §4): "Neue Treffen in deiner Nähe", weekly around the SET-11 region; opt-in, so every channel starts
        // off (web_push follows push). Nothing is sent without a home region.
        'event_nearby' => ['push' => false, 'email' => false],
        // M5.7 (m5.7-contract §8.2): SET-09 "Build-Erinnerungen" (push on) and "Wochenrückblick" (push on, e-mail on — the e-mail goes only
        // when no push went out, D-1). Both engagement types: at most 3 such pushes a week, never 22–08.
        'plan_due' => ['push' => true],
        'weekly_recap' => ['push' => true, 'email' => true],
    ];

    /**
     * M5.9d (contract §7): the SET-09 category of each gift type, its label `notifications.categories.<category>` (DE + EN).
     */
    public const GIFT_CATEGORIES = [
        'spot_alert' => 'spots',
        'badge_unlocked' => 'badges',
        'car_of_the_day' => 'car_of_the_day',
        'car_of_the_day_owner' => 'car_of_the_day',
        'invite_accepted' => 'invites',
    ];

    /**
     * M5.8: the SET-09 category of the forum types, its label `notifications.categories.forum` (DE + EN).
     */
    public const FORUM_CATEGORIES = [
        'forum_reply' => 'forum',
        'forum_mention' => 'forum',
        'forum_solved' => 'forum',
    ];

    /**
     * M5.6: the SET-09 category of the weekly nearby meets, its label `notifications.categories.events_nearby` (DE + EN).
     */
    public const EVENT_CATEGORIES = [
        'event_nearby' => 'events_nearby',
    ];

    /**
     * M5.7: the SET-09 category of the build prompts and the weekly recap, its label `notifications.categories.<category>` (DE + EN).
     */
    public const ENGAGEMENT_CATEGORIES = [
        'plan_due' => 'build_prompts',
        'weekly_recap' => 'weekly_recap',
    ];

    public const QUIET_HOURS = ['enabled' => true, 'from' => '22:00', 'to' => '07:00'];

    /** The channel of the member web's browser notifications, on every type. */
    public const WEB_PUSH = 'web_push';

    /** HH:MM, 00:00 to 23:59. */
    public const TIME_PATTERN = '/\A([01]\d|2[0-3]):[0-5]\d\z/';

    /**
     * @return Prefs
     */
    public static function defaults(): array
    {
        return ['types' => self::types(), 'quiet_hours' => self::QUIET_HOURS, 'message_previews' => false, 'digest_frequency' => DigestFrequency::Daily->value];
    }

    /**
     * TYPES with the `web_push` channel of each type, starting like its `push`.
     *
     * @return array<string, array<string, bool>>
     */
    public static function types(): array
    {
        return array_map(fn (array $channels): array => [...$channels, self::WEB_PUSH => $channels['push']], self::TYPES);
    }

    /**
     * What applies to the member: the stored choices over the defaults. Anything stored that the defaults do not know, or of the wrong
     * type, is ignored.
     *
     * @return Prefs
     */
    public static function for(User $user): array
    {
        /** @var mixed $stored */
        $stored = $user->getAttribute('notification_prefs');

        return self::merge(self::defaults(), is_array($stored) ? $stored : []);
    }

    /**
     * Deep merge of a validated patch over prefs; only known keys with values of the default's type are taken.
     *
     * @param  Prefs  $prefs
     * @param  array<mixed>  $patch
     * @return Prefs
     */
    public static function merge(array $prefs, array $patch): array
    {
        $types = is_array($patch['types'] ?? null) ? $patch['types'] : [];

        foreach (self::types() as $type => $channels) {
            $given = is_array($types[$type] ?? null) ? $types[$type] : [];

            foreach (array_keys($channels) as $channel) {
                if (is_bool($given[$channel] ?? null)) {
                    $prefs['types'][$type][$channel] = $given[$channel];
                }
            }
        }

        $quiet = is_array($patch['quiet_hours'] ?? null) ? $patch['quiet_hours'] : [];

        if (is_bool($quiet['enabled'] ?? null)) {
            $prefs['quiet_hours']['enabled'] = $quiet['enabled'];
        }

        foreach (['from', 'to'] as $edge) {
            if (is_string($quiet[$edge] ?? null) && preg_match(self::TIME_PATTERN, $quiet[$edge]) === 1) {
                $prefs['quiet_hours'][$edge] = $quiet[$edge];
            }
        }

        if (is_bool($patch['message_previews'] ?? null)) {
            $prefs['message_previews'] = $patch['message_previews'];
        }

        if (is_string($patch['digest_frequency'] ?? null) && DigestFrequency::tryFrom($patch['digest_frequency']) !== null) {
            $prefs['digest_frequency'] = $patch['digest_frequency'];
        }

        return $prefs;
    }

    public static function wantsPush(User $user, string $type): bool
    {
        return self::for($user)['types'][$type]['push'] ?? false;
    }

    /**
     * M4.15 (ADR-452): the member web's browser notifications of the type.
     */
    public static function wantsWebPush(User $user, string $type): bool
    {
        return self::for($user)['types'][$type][self::WEB_PUSH] ?? false;
    }
}
