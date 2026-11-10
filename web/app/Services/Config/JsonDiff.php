<?php

namespace App\Services\Config;

/**
 * The JSON diff of a config publish (m3.5 §1): the leaves that differ between two payloads, by dot path. Lists are compared as wholes
 * (an announcement list or a featured list reads better as before/after than item by item). A path missing on one side is null there.
 */
final class JsonDiff
{
    /**
     * @param  array<array-key, mixed>  $before
     * @param  array<array-key, mixed>  $after
     * @return array{before: array<string, mixed>, after: array<string, mixed>}
     */
    public static function between(array $before, array $after): array
    {
        $old = self::flatten($before);
        $new = self::flatten($after);
        $diff = ['before' => [], 'after' => []];

        foreach (array_unique([...array_keys($old), ...array_keys($new)]) as $path) {
            $a = $old[$path] ?? null;
            $b = $new[$path] ?? null;

            if ($a !== $b) {
                $diff['before'][$path] = $a;
                $diff['after'][$path] = $b;
            }
        }

        ksort($diff['before']);
        ksort($diff['after']);

        return $diff;
    }

    /**
     * @param  array<array-key, mixed>  $value
     * @return array<string, mixed>
     */
    private static function flatten(array $value, string $prefix = ''): array
    {
        $flat = [];

        foreach ($value as $key => $item) {
            $path = $prefix === '' ? (string) $key : $prefix.'.'.$key;

            if (is_array($item) && $item !== [] && ! array_is_list($item)) {
                $flat = [...$flat, ...self::flatten($item, $path)];
            } else {
                $flat[$path] = $item;
            }
        }

        return $flat;
    }
}
