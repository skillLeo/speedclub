<?php

namespace App\Services\Notifications;

use App\Models\User;

/**
 * users.notification_prefs (SET-09, M2.5 screen; the API since M2.2). Stored as what the member changed, read merged over the defaults of
 * the 02_PRODUCT_SPEC §7 matrix, so a default changed later reaches everybody who never touched it.
 *
 * @phpstan-type Prefs array{types: array<string, array<string, bool>>, quiet_hours: array{enabled: bool, from: string, to: string}, message_previews: bool}
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
    ];

    public const QUIET_HOURS = ['enabled' => true, 'from' => '22:00', 'to' => '07:00'];

    /** HH:MM, 00:00 to 23:59. */
    public const TIME_PATTERN = '/\A([01]\d|2[0-3]):[0-5]\d\z/';

    /**
     * @return Prefs
     */
    public static function defaults(): array
    {
        return ['types' => self::TYPES, 'quiet_hours' => self::QUIET_HOURS, 'message_previews' => false];
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

        foreach (self::TYPES as $type => $channels) {
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

        return $prefs;
    }

    public static function wantsPush(User $user, string $type): bool
    {
        return self::for($user)['types'][$type]['push'] ?? false;
    }
}
