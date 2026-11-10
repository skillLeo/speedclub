<?php

namespace App\Services\Garage;

use App\Models\Media;
use App\Models\Vehicle;

/**
 * The owner's hint, "Noch 3 Angaben bis zum vollständigen Build" (02_PRODUCT_SPEC §3.2, FS-4). Pure: it reads the vehicle and
 * writes nothing, and it is never part of what others see. Eager-load specs and media and count modifications for a list.
 *
 * @phpstan-type Hint array{key: string, label: string, section: string}
 * @phpstan-type Completeness array{percent: int, is_complete: bool, line: string, hint: string|null, missing: list<Hint>}
 */
class VehicleCompleteness
{
    /** Item => the section of GAR-02 that fills it. */
    private const SECTIONS = [
        'make' => 'basics', 'model' => 'basics', 'model_year' => 'basics', 'color' => 'basics', 'description' => 'basics',
        'engine' => 'specs', 'power' => 'specs', 'torque' => 'specs', 'drivetrain' => 'specs', 'gearbox' => 'specs',
        'photo' => 'photos', 'photos' => 'photos',
        'mod' => 'mods',
    ];

    private const ENOUGH_PHOTOS = 3;

    /**
     * @return Completeness
     */
    public function for(Vehicle $vehicle, string $locale): array
    {
        $done = $this->done($vehicle);
        $missing = [];

        foreach (self::SECTIONS as $key => $section) {
            if (! ($done[$key] ?? false)) {
                $missing[] = ['key' => $key, 'label' => (string) __('garage.completeness.'.$key, [], $locale), 'section' => $section];
            }
        }

        $count = count($missing);
        $percent = (int) round((count(self::SECTIONS) - $count) / count(self::SECTIONS) * 100);

        return [
            'percent' => $percent,
            'is_complete' => $count === 0,
            'line' => (string) __('garage.completeness.line', ['percent' => $percent], $locale),
            'hint' => $count === 0 ? null : trans_choice('garage.completeness.hint', $count, ['count' => $count], $locale),
            'missing' => $missing,
        ];
    }

    /**
     * @return array<string, bool>
     */
    private function done(Vehicle $vehicle): array
    {
        $specs = $vehicle->specs;
        $photos = $vehicle->media->filter(fn (Media $media): bool => $media->isUsablePhoto())->count();
        $mods = $vehicle->getAttribute('modifications_count') ?? $vehicle->modifications()->count();

        return [
            'make' => $vehicle->getAttribute('make_id') !== null || $vehicle->getAttribute('make_text') !== null,
            'model' => $vehicle->getAttribute('model_id') !== null || $vehicle->getAttribute('model_text') !== null,
            'model_year' => $vehicle->model_year !== null,
            'color' => $vehicle->getAttribute('color') !== null,
            'description' => $vehicle->getAttribute('description') !== null,
            'engine' => $specs?->getAttribute('engine_text') !== null || $specs?->getAttribute('engine_code') !== null,
            'power' => $specs?->power_value !== null,
            'torque' => $specs?->getAttribute('torque_nm') !== null,
            'drivetrain' => $specs?->getAttribute('drivetrain') !== null,
            'gearbox' => $specs?->getAttribute('gearbox') !== null,
            'photo' => $photos >= 1,
            'photos' => $photos >= self::ENOUGH_PHOTOS,
            'mod' => $mods > 0,
        ];
    }
}
