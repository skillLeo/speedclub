<?php

namespace App\Actions\Events;

use App\Enums\ErrorCode;
use App\Enums\KeywordField;
use App\Exceptions\ApiException;
use App\Models\Event;
use App\Services\Events\EventLocation;
use App\Services\Rules\ContentScreen;
use Carbon\CarbonImmutable;

/**
 * What CreateEvent and UpdateEvent share: the keyword screen of the public texts, the cross-field time rules and the area point.
 */
final class EventFields
{
    /**
     * @param  array<string, mixed>  $data
     * @return list<array{field: KeywordField, rules: list<array{id: int, term: string, list: string}>}> flag matches for after the commit
     *
     * @throws ApiException 422 content_blocked
     */
    public static function screen(array $data): array
    {
        $fields = [];

        foreach (['title', 'description', 'organiser_rules', 'venue_name'] as $field) {
            if (is_string($data[$field] ?? null) && $data[$field] !== '') {
                $fields[$field] = [KeywordField::EventText, $data[$field]];
            }
        }

        return $fields === [] ? [] : app(ContentScreen::class)->screen($fields);
    }

    /**
     * Fills $event from validated $data (only the keys present) and keeps the area point in step with lat/lng.
     *
     * @param  array<string, mixed>  $data
     */
    public static function fill(Event $event, array $data): void
    {
        $event->fill(array_intersect_key($data, array_flip($event->getFillable())));

        if (array_key_exists('rules', $data) && is_array($data['rules'])) {
            $event->rules = array_values(array_unique(array_map(strval(...), $data['rules'])));
        }

        $lat = $event->getAttribute('lat');
        $lng = $event->getAttribute('lng');

        if (is_numeric($lat) && is_numeric($lng)) {
            [$areaLat, $areaLng] = EventLocation::area((float) $lat, (float) $lng);
            $event->forceFill(['area_lat' => $areaLat, 'area_lng' => $areaLng]);
        } else {
            $event->forceFill(['area_lat' => null, 'area_lng' => null]);
        }

        self::assertTimes($event);
    }

    /**
     * End after start, at most max_duration_hours long.
     *
     * @throws ApiException 422
     */
    public static function assertTimes(Event $event): void
    {
        $starts = $event->starts_at;
        $ends = $event->ends_at;

        if (! $starts instanceof CarbonImmutable || ! $ends instanceof CarbonImmutable) {
            return;
        }

        if ($ends->lessThanOrEqualTo($starts)) {
            throw new ApiException(ErrorCode::ValidationFailed, errors: ['ends_at' => [(string) __('events.ends_before_start')]]);
        }

        $max = config()->integer('speedclub.events.max_duration_hours');

        if ($starts->diffInHours($ends) > $max) {
            throw new ApiException(ErrorCode::ValidationFailed, errors: ['ends_at' => [(string) __('events.too_long', ['hours' => $max])]]);
        }
    }
}
