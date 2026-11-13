<?php

namespace App\Http\Requests\Api\V1\Events;

use App\Enums\EventType;
use App\Support\Viewer;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * EVT-01 filters. `near` uses the device location only for this request (never stored, 09 §8.7) or the region chosen in SET-11.
 */
class EventListRequest extends FormRequest
{
    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            /** today · weekend (Sat–Sun of this week) · month (until its end) · upcoming (default). Europe/Berlin. */
            'when' => ['sometimes', Rule::in(['today', 'weekend', 'month', 'upcoming'])],
            'type' => ['sometimes', Rule::enum(EventType::class)],
            /** `home`: around the member's SET-11 region (ignored without one, and when lat/lng are given). */
            'near' => ['sometimes', Rule::in(['home'])],
            /** Words of the title or the city ("cars coffee hamburg"); every word must match. At most 80 characters. */
            'q' => ['sometimes', 'nullable', 'string', 'max:80'],
            'lat' => ['required_with:lng', 'numeric', 'between:-90,90'],
            'lng' => ['required_with:lat', 'numeric', 'between:-180,180'],
            /** Kilometres around lat/lng, default 50, at most 300. */
            'radius_km' => ['sometimes', 'integer', 'min:1', 'max:'.config()->integer('speedclub.events.near_max_km')],
            /** The map's view: minLng,minLat,maxLng,maxLat. */
            'bbox' => ['sometimes', 'string', 'regex:/\A-?\d{1,3}(\.\d+)?,-?\d{1,2}(\.\d+)?,-?\d{1,3}(\.\d+)?,-?\d{1,2}(\.\d+)?\z/'],
            'per_page' => ['sometimes', 'integer', 'min:1', 'max:50'],
            'cursor' => ['sometimes', 'string', 'max:512'],
        ];
    }

    /**
     * @return array{when?: string|null, type?: string|null, lat?: float|null, lng?: float|null, radius_km?: int|null, bbox?: array{0: float, 1: float, 2: float, 3: float}|null, q?: string|null}
     */
    public function filters(): array
    {
        $data = $this->validated();
        $bbox = null;

        if (($data['near'] ?? null) === 'home' && ! is_numeric($data['lat'] ?? null) && ($home = Viewer::from($this)?->homeRegionPoint()) !== null) {
            [$data['lat'], $data['lng']] = $home;
        }

        if (is_string($data['bbox'] ?? null)) {
            $parts = array_map(floatval(...), explode(',', $data['bbox']));
            $bbox = [min($parts[0], $parts[2]), min($parts[1], $parts[3]), max($parts[0], $parts[2]), max($parts[1], $parts[3])];
        }

        return [
            'when' => is_string($data['when'] ?? null) ? $data['when'] : null,
            'type' => is_string($data['type'] ?? null) ? $data['type'] : null,
            'lat' => is_numeric($data['lat'] ?? null) ? (float) $data['lat'] : null,
            'lng' => is_numeric($data['lng'] ?? null) ? (float) $data['lng'] : null,
            'radius_km' => is_numeric($data['radius_km'] ?? null) ? (int) $data['radius_km'] : null,
            'bbox' => $bbox,
            'q' => is_string($data['q'] ?? null) && trim($data['q']) !== '' ? trim($data['q']) : null,
        ];
    }

    public function pageSize(): int
    {
        return (int) ($this->validated('per_page') ?? config()->integer('speedclub.events.list_page_size'));
    }
}
