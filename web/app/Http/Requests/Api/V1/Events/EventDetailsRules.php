<?php

namespace App\Http\Requests\Api\V1\Events;

use App\Enums\EventLocationVisibility;
use App\Enums\EventRule;
use App\Enums\EventType;
use App\Enums\EventVisibility;
use Carbon\CarbonImmutable;
use Illuminate\Validation\Rule;

/**
 * The fields of an event shared by create and update (EVT-03). Times are ISO 8601 with an offset; the event lives in Europe/Berlin.
 */
final class EventDetailsRules
{
    /**
     * @return array<string, mixed>
     */
    public static function rules(bool $create): array
    {
        $required = $create ? 'required' : 'sometimes';
        $config = 'speedclub.events.';

        return [
            'title' => [$required, 'string', 'min:3', 'max:'.config()->integer($config.'title_max')],
            'type' => [$required, Rule::enum(EventType::class)],
            'visibility' => ['sometimes', Rule::enum(EventVisibility::class)],
            'location_visibility' => ['sometimes', Rule::enum(EventLocationVisibility::class)],
            'starts_at' => ['sometimes', 'nullable', 'date', 'after:now', 'before:'.now()->addDays(config()->integer($config.'max_days_ahead'))->toIso8601String()],
            'ends_at' => ['sometimes', 'nullable', 'date', 'after:now'],
            'venue_name' => ['sometimes', 'nullable', 'string', 'max:120'],
            'street' => ['sometimes', 'nullable', 'string', 'max:160'],
            'postcode' => ['sometimes', 'nullable', 'string', 'max:10', 'regex:/\A[0-9A-Za-z \-]{3,10}\z/'],
            'city' => ['sometimes', 'nullable', 'string', 'max:80'],
            'country' => ['sometimes', 'string', 'size:2', 'alpha'],
            'lat' => ['required_with:lng', 'nullable', 'numeric', 'between:-90,90'],
            'lng' => ['required_with:lat', 'nullable', 'numeric', 'between:-180,180'],
            'description' => ['sometimes', 'nullable', 'string', 'max:'.config()->integer($config.'description_max')],
            'organiser_rules' => ['sometimes', 'nullable', 'string', 'max:'.config()->integer($config.'rules_max')],
            'rules' => ['sometimes', 'array', 'max:'.count(EventRule::cases())],
            'rules.*' => ['string', Rule::enum(EventRule::class)],
            'capacity' => ['sometimes', 'nullable', 'integer', 'min:1', 'max:'.config()->integer($config.'max_capacity')],
        ];
    }

    /**
     * ISO strings to Carbon, country upper case: what the model stores.
     *
     * @param  array<string, mixed>  $data
     * @return array<string, mixed>
     */
    public static function normalise(array $data): array
    {
        foreach (['starts_at', 'ends_at'] as $field) {
            if (is_string($data[$field] ?? null)) {
                $data[$field] = CarbonImmutable::parse($data[$field])->utc();
            }
        }

        if (is_string($data['country'] ?? null)) {
            $data['country'] = strtoupper($data['country']);
        }

        foreach (['lat', 'lng'] as $field) {
            if (is_numeric($data[$field] ?? null)) {
                $data[$field] = round((float) $data[$field], 6);
            }
        }

        return $data;
    }
}
