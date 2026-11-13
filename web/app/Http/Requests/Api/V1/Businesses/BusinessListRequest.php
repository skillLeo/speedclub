<?php

namespace App\Http\Requests\Api\V1\Businesses;

use App\Enums\BusinessKind;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * The Betriebe scope and "Werkstätten in deiner Nähe": `q` (name, city, services), `city`, `kind`, `service`, `lat` + `lng` with
 * `radius_km` (default 50, at most 300) for nearby businesses with `distance_km`.
 */
class BusinessListRequest extends FormRequest
{
    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'q' => ['sometimes', 'nullable', 'string', 'min:2', 'max:80'],
            'city' => ['sometimes', 'nullable', 'string', 'max:80'],
            'kind' => ['sometimes', 'nullable', Rule::enum(BusinessKind::class)],
            'service' => ['sometimes', 'nullable', 'string', 'max:40'],
            'lat' => ['nullable', 'numeric', 'between:-90,90', 'required_with:lng'],
            'lng' => ['nullable', 'numeric', 'between:-180,180', 'required_with:lat'],
            'radius_km' => ['sometimes', 'integer', 'min:1', 'max:'.config()->integer('speedclub.businesses.near_max_km')],
            'per_page' => ['sometimes', 'integer', 'min:1', 'max:'.config()->integer('speedclub.businesses.max_page_size')],
            'cursor' => ['sometimes', 'string', 'max:512'],
        ];
    }

    /**
     * @return array{q: string|null, city: string|null, kind: string|null, service: string|null, lat: float|null, lng: float|null, radius_km: int}
     */
    public function filters(): array
    {
        $string = fn (string $key): ?string => is_string($value = $this->validated($key)) && trim($value) !== '' ? trim($value) : null;
        $lat = $this->validated('lat');
        $lng = $this->validated('lng');

        return [
            'q' => $string('q'),
            'city' => $string('city'),
            'kind' => $string('kind'),
            'service' => $string('service'),
            'lat' => is_numeric($lat) ? (float) $lat : null,
            'lng' => is_numeric($lng) ? (float) $lng : null,
            'radius_km' => (int) ($this->validated('radius_km') ?? config()->integer('speedclub.businesses.near_default_km')),
        ];
    }

    public function pageSize(): int
    {
        return (int) ($this->validated('per_page') ?? config()->integer('speedclub.businesses.page_size'));
    }
}
