<?php

namespace App\Services\Admin\Spots;

use JsonException;

/**
 * The city centroids of ADM-62's "impossible city hopping" signal: read by the server from the public reference file
 * `public/geo/de-cities.json` (GeoNames, CC BY 4.0; ADR-508), never stored with a spot, never sent to a page. A spot keeps its city id
 * only; the distance between two cities is computed here and leaves this class as whole kilometres.
 *
 * File rows: [geonames id, name, bundesland, lat, lng, population].
 */
final class CityCentroids
{
    private const EARTH_KM = 6371.0;

    /** @var array<int, array{0: float, 1: float}>|null */
    private static ?array $points = null;

    /**
     * Kilometres between the centroids of two cities (great circle), or null when one of them is not in the file.
     */
    public static function km(int $from, int $to): ?float
    {
        if ($from === $to) {
            return 0.0;
        }

        $points = self::points();
        $a = $points[$from] ?? null;
        $b = $points[$to] ?? null;

        if ($a === null || $b === null) {
            return null;
        }

        [$lat1, $lng1] = [deg2rad($a[0]), deg2rad($a[1])];
        [$lat2, $lng2] = [deg2rad($b[0]), deg2rad($b[1])];
        $h = sin(($lat2 - $lat1) / 2) ** 2 + cos($lat1) * cos($lat2) * sin(($lng2 - $lng1) / 2) ** 2;

        return 2 * self::EARTH_KM * asin(min(1.0, sqrt($h)));
    }

    /** Drops the parsed file (tests that write their own file). */
    public static function forget(): void
    {
        self::$points = null;
    }

    public static function path(): string
    {
        return public_path('geo/de-cities.json');
    }

    /**
     * @return array<int, array{0: float, 1: float}>
     */
    private static function points(): array
    {
        if (self::$points !== null) {
            return self::$points;
        }

        $points = [];
        $raw = is_file(self::path()) ? file_get_contents(self::path()) : false;

        try {
            $data = is_string($raw) ? json_decode($raw, true, 8, JSON_THROW_ON_ERROR) : null;
        } catch (JsonException $exception) {
            report($exception);
            $data = null;
        }

        $rows = is_array($data) && is_array($data['cities'] ?? null) ? $data['cities'] : [];

        foreach ($rows as $row) {
            if (is_array($row) && is_int($row[0] ?? null) && is_numeric($row[3] ?? null) && is_numeric($row[4] ?? null)) {
                $points[$row[0]] = [(float) $row[3], (float) $row[4]];
            }
        }

        return self::$points = $points;
    }
}
