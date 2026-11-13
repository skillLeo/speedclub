<?php

namespace App\Services\Events;

use App\Enums\EventLocationVisibility;
use App\Models\Event;
use App\Models\User;

/**
 * The private-location rule of 09 §8.7 in one place. With location_visibility after_rsvp the exact place (venue, street, postcode and
 * coordinates) reaches only the organiser and members whose answer is "going" — never a list, the waitlist, an interested member, a
 * guest, OG tags, JSON-LD or another reader's calendar file. Everybody else gets the city and the area point: the exact point snapped to
 * a grid of AREA_STEP degrees (about 5.5 km north–south, 3.5 km east–west in Germany), which also drives the map pins and distances.
 */
final class EventLocation
{
    public const AREA_STEP = 0.05;

    /**
     * @return array{0: float, 1: float} the area point of an exact point: the centre of its grid cell
     */
    public static function area(float $lat, float $lng): array
    {
        $snap = fn (float $value): float => round((floor($value / self::AREA_STEP) + 0.5) * self::AREA_STEP, 6);

        return [$snap($lat), $snap($lng)];
    }

    /**
     * Whether $viewer may read the exact place of $event.
     */
    public static function exactFor(Event $event, ?User $viewer): bool
    {
        if ($event->location_visibility === EventLocationVisibility::Public) {
            return true;
        }

        // Security review L3: a suspended or closed account keeps no exact place, also not through a signed calendar link.
        return $viewer !== null && ($event->isOrganisedBy($viewer) || ($viewer->isActive() && $event->isGoing($viewer)));
    }

    /**
     * The location block of an API answer.
     *
     * @return array{visibility: string, exact: bool, venue_name: string|null, street: string|null, postcode: string|null, city: string|null, country: string, lat: float|null, lng: float|null, area: array{lat: float|null, lng: float|null}}
     */
    public static function present(Event $event, bool $exact): array
    {
        $areaLat = $event->getAttribute('area_lat');
        $areaLng = $event->getAttribute('area_lng');

        return [
            'visibility' => $event->location_visibility->value,
            'exact' => $exact,
            'venue_name' => $exact ? self::string($event->getAttribute('venue_name')) : null,
            'street' => $exact ? self::string($event->getAttribute('street')) : null,
            'postcode' => $exact ? self::string($event->getAttribute('postcode')) : null,
            'city' => $event->city,
            'country' => (string) ($event->getAttribute('country') ?? 'DE'),
            'lat' => $exact && is_numeric($event->getAttribute('lat')) ? (float) $event->getAttribute('lat') : null,
            'lng' => $exact && is_numeric($event->getAttribute('lng')) ? (float) $event->getAttribute('lng') : null,
            'area' => [
                'lat' => is_numeric($areaLat) ? (float) $areaLat : null,
                'lng' => is_numeric($areaLng) ? (float) $areaLng : null,
            ],
        ];
    }

    /**
     * Great-circle distance in km between two points (haversine), rounded to whole km.
     */
    public static function distanceKm(float $lat1, float $lng1, float $lat2, float $lng2): int
    {
        $dLat = deg2rad($lat2 - $lat1);
        $dLng = deg2rad($lng2 - $lng1);
        $a = sin($dLat / 2) ** 2 + cos(deg2rad($lat1)) * cos(deg2rad($lat2)) * sin($dLng / 2) ** 2;

        return (int) round(6371 * 2 * atan2(sqrt($a), sqrt(1 - $a)));
    }

    private static function string(mixed $value): ?string
    {
        return is_string($value) && $value !== '' ? $value : null;
    }
}
