<?php

namespace App\Http\Requests\Api\V1\Dex;

use App\Enums\Bundesland;
use App\Models\DeCity;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

/**
 * POST spots (m5.9b contract §0, §2). The code and, when the device found one, the city id (its Bundesland wins) or a city name with
 * the Bundesland. Any other field is refused with 422, coordinates above all: a spot never carries a position.
 */
class StoreSpotRequest extends FormRequest
{
    public const FIELDS = ['code', 'city_id', 'city', 'bundesland'];

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            /** The sticker's 8-character code as scanned from /c/{code} (case and Crockford read-alikes do not matter). */
            'code' => ['required', 'string', 'max:16'],
            /** A de_cities id (the GeoNames id of public/geo/de-cities.json), picked on the device. */
            'city_id' => ['sometimes', 'nullable', 'integer', Rule::exists(DeCity::class, 'id')],
            /** Fallback: a city name, matched to de_cities; no match stores no city. */
            'city' => ['sometimes', 'nullable', 'string', 'max:80'],
            'bundesland' => ['sometimes', 'nullable', Rule::enum(Bundesland::class)],
        ];
    }

    /**
     * @return list<callable(Validator): void>
     */
    public function after(): array
    {
        return [function (Validator $validator): void {
            foreach (array_keys($this->all()) as $key) {
                if (! in_array($key, self::FIELDS, true)) {
                    $validator->errors()->add((string) $key, (string) __('validation.prohibited', ['attribute' => (string) $key]));
                }
            }
        }];
    }
}
