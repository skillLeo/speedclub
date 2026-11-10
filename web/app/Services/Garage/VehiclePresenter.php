<?php

namespace App\Services\Garage;

use App\Enums\MediaStatus;
use App\Enums\ModerationStatus;
use App\Enums\PowerDisplay;
use App\Models\Media;
use App\Models\Vehicle;
use App\Models\VehicleSpec;
use App\Support\Units;

/**
 * What FS-3 and FS-4 display, as values: eyebrow make, title, sub-line parts, spec strip and the Technik tables. Power follows
 * the viewer's setting, and the provenance label travels with the value (02_PRODUCT_SPEC §3.2, §3.9).
 *
 * @phpstan-type StripEntry array{key: string, value: string|null, unit: string|null, label: string}
 * @phpstan-type SpecRow array{key: string, label: string, value: string, source: string|null, source_label: string|null}
 * @phpstan-type SpecGroup array{key: string, label: string, rows: list<SpecRow>}
 */
class VehiclePresenter
{
    /**
     * Others see finished, unrejected photos only (MediaPolicy). A failed upload is in no list and no count; its owner reads it
     * apart, under failed_photos of VehicleResource.
     */
    public function photoVisibleTo(Media $media, bool $asOwner): bool
    {
        if ($media->status === MediaStatus::Failed) {
            return false;
        }

        return $asOwner || ($media->status === MediaStatus::Ready && $media->moderation_status !== ModerationStatus::Rejected);
    }

    /**
     * The cover a viewer may see: the chosen cover, else the first visible photo. Needs media (and cover) loaded for lists.
     */
    public function cover(Vehicle $vehicle, bool $asOwner): ?Media
    {
        $cover = $vehicle->cover;

        if ($cover instanceof Media && $this->photoVisibleTo($cover, $asOwner)) {
            return $cover;
        }

        return $vehicle->media
            ->filter(fn (Media $media): bool => $this->photoVisibleTo($media, $asOwner))
            ->sortBy([['sort', 'asc'], ['id', 'asc']])
            ->first();
    }

    public function makeName(Vehicle $vehicle): ?string
    {
        return $vehicle->make->name ?? $vehicle->getAttribute('make_text');
    }

    public function modelName(Vehicle $vehicle): ?string
    {
        return $vehicle->vehicleModel->name ?? $vehicle->getAttribute('model_text');
    }

    public function eyebrow(Vehicle $vehicle): ?string
    {
        $make = $this->makeName($vehicle);

        return $make === null ? null : mb_strtoupper($make);
    }

    /**
     * "Skyline GT-R R34", as stored.
     */
    public function title(Vehicle $vehicle): string
    {
        return trim($this->modelName($vehicle).' '.$vehicle->generation?->name);
    }

    /**
     * The short form of a strip under an avatar (DQ-293): model and generation, no make, no engine, "Skyline R34", "M4 G82",
     * "Golf GTI VII". A model of speedclub.home.car_short_models uses its short name; a generation drops its bracket ("VII (5G)" → "VII").
     * Null when neither is known.
     */
    public function shortTitle(Vehicle $vehicle): ?string
    {
        $model = $vehicle->vehicleModel;
        /** @var array<string, string> $shortNames */
        $shortNames = config()->array('speedclub.home.car_short_models');
        $key = $model !== null && $vehicle->make !== null ? $vehicle->make->slug.'--'.$model->slug : null;
        $name = ($key !== null ? ($shortNames[$key] ?? null) : null) ?? $this->modelName($vehicle);
        $generation = $vehicle->generation?->name;
        $generation = $generation === null ? null : trim((string) preg_replace('/\s*\(.*\)\s*$/u', '', $generation));
        $short = trim(($name ?? '').' '.($generation ?? ''));

        return $short === '' ? null : $short;
    }

    /**
     * "Nissan Skyline GT-R R34"
     */
    public function fullTitle(Vehicle $vehicle): string
    {
        return trim($this->makeName($vehicle).' '.$this->title($vehicle));
    }

    /**
     * ["2002", "2,6 l R6 Biturbo (RB26DETT)", "Bayside Blue"]; the client joins them with its own separator.
     *
     * @return list<string>
     */
    public function subline(Vehicle $vehicle, string $locale): array
    {
        return array_values(array_filter([
            $vehicle->model_year === null ? null : (string) $vehicle->model_year,
            $this->engineLine($vehicle->specs, $locale),
            $vehicle->getAttribute('color'),
        ], fn (mixed $part): bool => is_string($part) && $part !== ''));
    }

    /**
     * Four equal columns, "500 PS · 540 Nm · 2002 Baujahr · AWD Antrieb". A value not entered yet is null, and the column stays.
     *
     * @return list<StripEntry>
     */
    public function specStrip(Vehicle $vehicle, PowerDisplay $display, string $locale): array
    {
        $specs = $vehicle->specs;
        $power = $specs !== null && $specs->power_value !== null && $specs->power_unit !== null
            ? Units::powerParts($specs->power_value, $specs->power_unit, $display, $locale)
            : null;

        $torque = $specs?->getAttribute('torque_nm');
        $drivetrain = $specs?->getAttribute('drivetrain');
        $emptyPowerUnit = match ($display) {
            PowerDisplay::PsKw => 'PS',
            PowerDisplay::KwPs => 'kW',
            PowerDisplay::Hp => 'hp',
        };

        return [
            ['key' => 'power', 'value' => $power['value'] ?? null, 'unit' => $power['unit'] ?? $emptyPowerUnit, 'label' => $power['unit'] ?? $emptyPowerUnit],
            ['key' => 'torque', 'value' => is_int($torque) ? Units::formatNumber($torque, $locale, 0) : null, 'unit' => 'Nm', 'label' => 'Nm'],
            ['key' => 'model_year', 'value' => $vehicle->model_year === null ? null : (string) $vehicle->model_year, 'unit' => null, 'label' => (string) __('garage.strip.model_year', [], $locale)],
            [
                'key' => 'drivetrain',
                'value' => $drivetrain === null ? null : (string) __('garage.drivetrain_short.'.$drivetrain->value, [], $locale),
                'unit' => null,
                'label' => (string) __('garage.strip.drivetrain', [], $locale),
            ],
        ];
    }

    /**
     * The grouped tables of the Technik tab; groups without a value stay out.
     *
     * @return list<SpecGroup>
     */
    public function specGroups(Vehicle $vehicle, PowerDisplay $display, string $locale): array
    {
        $specs = $vehicle->specs;
        $row = fn (string $key, ?string $value, ?string $source = null, ?string $sourceLabel = null): array => [
            'key' => $key,
            'label' => (string) __('garage.spec.'.$key, [], $locale),
            'value' => (string) $value,
            'source' => $source,
            'source_label' => $sourceLabel,
        ];

        $power = $specs === null ? null : $this->power($specs, $display, $locale);
        $torque = $specs === null ? null : $this->torque($specs, $locale);
        $displacement = $specs?->getAttribute('displacement_cc');

        $groups = [
            'vehicle' => [
                $this->makeName($vehicle) === null ? null : $row('make', $this->makeName($vehicle)),
                $this->modelName($vehicle) === null ? null : $row('model', $this->modelName($vehicle)),
                $vehicle->generation === null ? null : $row('generation', $vehicle->generation->name),
                $vehicle->model_year === null ? null : $row('model_year', (string) $vehicle->model_year),
                $vehicle->getAttribute('color') === null ? null : $row('color', $vehicle->getAttribute('color')),
            ],
            'engine' => [
                $specs?->getAttribute('engine_text') === null ? null : $row('engine_text', $specs->getAttribute('engine_text')),
                $specs?->getAttribute('engine_code') === null ? null : $row('engine_code', $specs->getAttribute('engine_code')),
                is_int($displacement) ? $row('displacement_cc', Units::formatDisplacement($displacement, $locale)) : null,
                $specs?->getAttribute('fuel') === null ? null : $row('fuel', $specs->getAttribute('fuel')->label($locale)),
                $specs?->getAttribute('aspiration') === null ? null : $row('aspiration', $specs->getAttribute('aspiration')->label($locale)),
            ],
            'power' => [
                $power === null ? null : $row('power', $power['label'], $power['source'], $power['source_label']),
                $torque === null ? null : $row('torque', $torque['label'], $torque['source'], $torque['source_label']),
            ],
            'drivetrain' => [
                $specs?->getAttribute('drivetrain') === null ? null : $row('drivetrain', $specs->getAttribute('drivetrain')->label($locale)),
                $specs?->getAttribute('gearbox') === null ? null : $row('gearbox', $specs->getAttribute('gearbox')->label($locale)),
            ],
        ];

        $result = [];

        foreach ($groups as $key => $rows) {
            $rows = array_values(array_filter($rows));

            if ($rows !== []) {
                $result[] = ['key' => $key, 'label' => (string) __('garage.spec_group.'.$key, [], $locale), 'rows' => $rows];
            }
        }

        return $result;
    }

    /**
     * "510 PS (375 kW)" in the viewer's setting, with what was entered next to it.
     *
     * @return array{label: string, value: float, unit: string, ps: float, source: string|null, source_label: string|null}|null
     */
    public function power(VehicleSpec $specs, PowerDisplay $display, string $locale): ?array
    {
        if ($specs->power_value === null || $specs->power_unit === null) {
            return null;
        }

        return [
            'label' => Units::formatPower($specs->power_value, $specs->power_unit, $display, $locale),
            'value' => $specs->power_value,
            'unit' => $specs->power_unit->value,
            'ps' => (float) $specs->power_ps,
            'source' => $specs->power_source?->value,
            'source_label' => $specs->power_source?->label($locale),
        ];
    }

    /**
     * @return array{label: string, nm: int, source: string|null, source_label: string|null}|null
     */
    public function torque(VehicleSpec $specs, string $locale): ?array
    {
        $torque = $specs->getAttribute('torque_nm');
        $source = $specs->getAttribute('torque_source');

        if (! is_int($torque)) {
            return null;
        }

        return [
            'label' => Units::formatTorque($torque, $locale),
            'nm' => $torque,
            'source' => $source?->value,
            'source_label' => $source?->label($locale),
        ];
    }

    private function engineLine(?VehicleSpec $specs, string $locale): ?string
    {
        if ($specs === null) {
            return null;
        }

        $text = $specs->getAttribute('engine_text');
        $code = $specs->getAttribute('engine_code');
        $displacement = $specs->getAttribute('displacement_cc');

        return match (true) {
            is_string($text) && is_string($code) => "$text ($code)",
            is_string($text) => $text,
            is_int($displacement) && is_string($code) => Units::formatDisplacementShort($displacement, $locale)." ($code)",
            is_string($code) => $code,
            is_int($displacement) => Units::formatDisplacementShort($displacement, $locale),
            default => null,
        };
    }
}
