<?php

namespace App\Services\Engagement;

/**
 * M5.7 (m5.7-contract §6.4): the parts of a weekly recap in a fixed order, only the non-zero ones ("128 Aufrufe", "14 Sticker-Scans",
 * "3 neue Follower", "2 Spots", "1 Wartung bald fällig", "2 Treffen in deiner Nähe"). Never a zero, never a comparison with last week.
 */
final class RecapTexts
{
    /** payload key => lang key under notifications.weekly_recap.parts */
    private const PARTS = ['views', 'sticker_scans', 'new_followers', 'spots', 'maintenance_due', 'events_nearby'];

    /** At most this many parts in the push body. */
    public const PUSH_PARTS = 3;

    /**
     * @param  array<string, mixed>  $payload
     * @return list<string>
     */
    public static function parts(array $payload, string $locale): array
    {
        $parts = [];

        foreach (self::PARTS as $key) {
            $value = $payload[$key] ?? 0;
            $count = is_int($value) ? $value : 0;

            if ($count > 0) {
                $parts[] = trans_choice('notifications.weekly_recap.parts.'.$key, $count, [
                    'count' => $locale === 'de' ? number_format($count, 0, ',', '.') : number_format($count),
                ], $locale);
            }
        }

        return $parts;
    }

    /**
     * @param  array<string, mixed>  $payload
     */
    public static function pushBody(array $payload, string $locale): ?string
    {
        $parts = array_slice(self::parts($payload, $locale), 0, self::PUSH_PARTS);

        return $parts === [] ? null : implode(' · ', $parts);
    }
}
