<?php

namespace App\Services\Showcase;

use Illuminate\Support\Str;

/**
 * Which seed photo may go on which showcase vehicle (DemoShowcaseSeeder). A photo is only ever used for a vehicle whose make, model
 * and generation it shows: the manifest entry's own make/model/generation, or for the entries of 2026-11-02 that carry only a
 * `vehicle` key, the file's row in database/data/showcase/photo-map.json. Generic photos (no vehicle) are never used.
 *
 * Every vehicle gets photos of its own (a whole shoot of one car when the manifest groups them, else 4-8 consecutive files), and no
 * photo goes on two showcase vehicles. When a generation has photos for fewer
 * vehicles than the data lists, the later vehicles of that generation are left out (the seeder names them). Photos of one shoot stay
 * together: an optional `set`/`car`/`group` field of the manifest groups them; without one, a vehicle takes a run of consecutive
 * files. Photos the classic demo (DemoSeeder) already shows come last, so a showcase build repeats a demo build only when nothing else
 * is left.
 *
 * Sample photos carry the one editorial grade of 09 §4.6: when design/scripts/process-photos.mjs has written the graded 2048 px JPEG
 * (processed/<name>-2048.jpg), `path` is that file and `graded` is true; the raw file is only the fallback of a folder that was never
 * processed. `thumbhash` is the manifest's ThumbHash of the graded photo.
 *
 * @phpstan-type Photo array{file: string, path: string, graded: bool, thumbhash: string|null, category: string, alt: string|null, focal_x: float|null, focal_y: float|null, color: string|null, group: string|null, demo: bool}
 * @phpstan-type Candidate array{key: string, make: string, model: string, generation: string, pick: string|null}
 */
final class ShowcasePhotos
{
    public const MIN = 4;

    public const MAX = 8;

    /** Photos one grouped shoot (one physical car) needs to become a build. */
    public const MIN_SHOOT = 1;

    /** The rendition the seeders import (process-photos.mjs: processed/<stem>-<width>.jpg). */
    public const GRADED_WIDTH = 2048;

    private const CATEGORY_ORDER = ['exterior' => 0, 'detail' => 1, 'wheels' => 2, 'interior' => 3, 'engine' => 4, 'other' => 5];

    /** @var list<array{photo: Photo, make: string, model: string, generation: string}> */
    private array $entries = [];

    /** @var list<string> */
    private array $ignored = [];

    /**
     * @param  list<mixed>  $manifest  the decoded manifest.json
     * @param  array<string, array{make: string, model: string, generation: string}>  $legacy  file => catalogue names
     * @param  list<string>  $demoFiles  files DemoSeeder uses
     */
    public function __construct(private readonly string $directory, array $manifest, array $legacy, array $demoFiles)
    {
        foreach ($manifest as $entry) {
            if (! is_array($entry) || ! is_string($entry['file'] ?? null)) {
                continue;
            }

            $file = $entry['file'];
            $names = $this->names($entry) ?? ($legacy[$file] ?? null);
            $path = rtrim($this->directory, '/').'/'.$file;

            if ($names === null || ! is_file($path)) {
                $this->ignored[] = $file;

                continue;
            }

            $focal = is_array($entry['focal'] ?? null) ? $entry['focal'] : [];
            $graded = self::gradedPath($this->directory, $file);
            $thumbhash = $entry['thumbhash'] ?? null;
            $group = $entry['set'] ?? $entry['car'] ?? $entry['group'] ?? null;
            $color = $entry['color'] ?? $entry['colour'] ?? null;

            $this->entries[] = [
                'photo' => [
                    'file' => $file,
                    'path' => $graded ?? $path,
                    'graded' => $graded !== null,
                    'thumbhash' => is_string($thumbhash) && preg_match('/\A[A-Za-z0-9+\/]{6,60}={0,2}\z/', $thumbhash) === 1 ? $thumbhash : null,
                    'category' => is_string($entry['category'] ?? null) ? $entry['category'] : 'other',
                    'alt' => is_string($entry['alt_de'] ?? null) ? $entry['alt_de'] : null,
                    'focal_x' => is_numeric($focal['x'] ?? null) ? (float) $focal['x'] : null,
                    'focal_y' => is_numeric($focal['y'] ?? null) ? (float) $focal['y'] : null,
                    'color' => is_string($color) && $color !== '' ? $color : null,
                    'group' => is_scalar($group) && (string) $group !== '' ? (string) $group : null,
                    'demo' => in_array($file, $demoFiles, true),
                ],
                ...$names,
            ];
        }
    }

    /**
     * The graded rendition of a seed photo, when process-photos.mjs wrote it.
     */
    public static function gradedPath(string $directory, string $file): ?string
    {
        $path = rtrim($directory, '/').'/processed/'.preg_replace('/\.jpe?g\z/i', '', $file).'-'.self::GRADED_WIDTH.'.jpg';

        return is_file($path) ? $path : null;
    }

    /**
     * The photos of one shoot (the manifest's `car`) for a build that names it, cover first: only when every photo shows the build's
     * make, model and generation and none of them is in $taken (files already on another build). Null otherwise, so the caller leaves
     * the build out rather than show a wrong or a shared photo.
     *
     * @param  Candidate  $candidate
     * @param  array<string, true>  $taken  file => true
     * @return list<Photo>|null
     */
    public function shoot(array $candidate, string $car, array $taken): ?array
    {
        $photos = [];

        foreach ($this->entries as $entry) {
            if ($entry['photo']['group'] !== $car) {
                continue;
            }

            if (isset($taken[$entry['photo']['file']]) || ! self::matches($entry['make'], $entry['model'], $entry['generation'], $candidate['make'], $candidate['model'], $candidate['generation'])) {
                return null;
            }

            $photos[] = $entry['photo'];
        }

        return count($photos) >= self::MIN_SHOOT ? $this->coverFirst(array_slice($photos, 0, self::MAX)) : null;
    }

    /**
     * @return list<string> manifest files that name no vehicle or are missing on disk
     */
    public function ignored(): array
    {
        return $this->ignored;
    }

    /**
     * Whether a photo labelled (make, model, generation) shows a vehicle of the catalogue entry (make, model, generation).
     */
    public static function matches(string $make, string $model, string $generation, string $catalogueMake, string $catalogueModel, string $catalogueGeneration): bool
    {
        $make = self::make($make);

        if ($make !== self::make($catalogueMake)) {
            return false;
        }

        if (! self::modelMatches($make, $model, $catalogueMake, $catalogueModel)) {
            return false;
        }

        $catalogueNames = self::generationNames($catalogueGeneration);

        foreach (self::photoGenerationNames($generation) as $name) {
            foreach ($catalogueNames as $catalogueName) {
                // "AP" is the AP1 and "981" the 981c: the photo names the family, the catalogue adds one trailing letter or digit. Never
                // between Roman numerals: "VII" + "I" is the next generation (a Golf Mk7 is not the VIII, a Mk2 not the III).
                if ($name === $catalogueName || (strlen($name) >= 2 && strlen($catalogueName) === strlen($name) + 1 && str_starts_with($catalogueName, $name) && preg_match('/\A[ivx]+\z/', $catalogueName) !== 1)) {
                    return true;
                }
            }
        }

        return false;
    }

    /**
     * Photo model names the catalogue spells differently (the European S14 is the 200SX; the AE86 entry covers Levin and Trueno).
     */
    private const MODEL_ALIASES = [
        'sprintertrueno' => 'corollalevintrueno',
        'corollalevin' => 'corollalevintrueno',
        'grsupra' => 'supra',
        'a45' => 'a45amg',
        'a45s' => 'a45amg',
        'silvia' => '200sx',
    ];

    /**
     * The photo's model is the catalogue model or a variant of it: "911 GT3 RS" is a 911, "RS3 Limousine" an RS3, "Corrado G60" a
     * Corrado. The generation check still has to agree, so a variant never crosses generations.
     */
    private static function modelMatches(string $make, string $model, string $catalogueMake, string $catalogueModel): bool
    {
        $wanted = self::normal($catalogueModel);
        $model = self::normal($model);

        foreach (['', self::normal($catalogueMake), 'mercedesamg'] as $prefix) {
            if ($prefix !== '' && str_starts_with($model, $prefix) && ($prefix !== 'mercedesamg' || $make === 'mercedesbenz')) {
                $model = substr($model, strlen($prefix));
            }
        }

        $names = array_unique([$model, self::MODEL_ALIASES[$model] ?? $model]);

        foreach ($names as $name) {
            if ($wanted !== '' && ($name === $wanted || (strlen($wanted) >= 2 && str_starts_with($name, $wanted)))) {
                return true;
            }
        }

        return false;
    }

    /**
     * The names a photo's generation goes by: the catalogue rules plus its first word ("GD (Blobeye)" is a GD) and the Roman numeral
     * of a VW "Mk" generation ("Mk7" is the VII).
     *
     * @return list<string>
     */
    private static function photoGenerationNames(string $generation): array
    {
        $names = self::generationNames($generation);
        $first = Str::lower((string) (preg_split('/[^A-Za-z0-9]+/', Str::ascii(trim($generation))) ?: [''])[0]);

        if ($first !== '' && $first !== 'typ') {
            $names[] = $first;
        }

        if (preg_match('/^mk(\d{1,2})$/', $first, $mk) === 1) {
            $names[] = ['', 'i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x'][(int) $mk[1]] ?? '';
        }

        return array_values(array_unique(array_filter($names)));
    }

    /**
     * Photos per vehicle key, for the candidates in their order. Candidates sharing a `pick` are alternatives: the first one that can
     * get enough photos is taken, the others are left out. Picks are served first.
     *
     * @param  list<Candidate>  $candidates
     * @return array<string, list<Photo>>
     */
    public function allocate(array $candidates, int $maxVehicles): array
    {
        $pools = [];

        foreach ($candidates as $candidate) {
            $triple = $this->tripleKey($candidate);
            $pools[$triple] ??= $this->pool($candidate);
        }

        $assigned = [];

        // Alternatives first (the showcase account), so its builds get the best-covered generations: per pick, the alternative whose
        // pool holds the largest shoot of one car (ties keep the data order), then the next ones should that one yield nothing.
        $alternatives = [];

        foreach ($candidates as $candidate) {
            if ($candidate['pick'] !== null) {
                $alternatives[$candidate['pick']][] = $candidate;
            }
        }

        foreach ($alternatives as $options) {
            usort($options, fn (array $a, array $b): int => $this->largestShoot($pools[$this->tripleKey($b)]) <=> $this->largestShoot($pools[$this->tripleKey($a)]));

            foreach ($options as $candidate) {
                $photos = $this->take($pools[$this->tripleKey($candidate)], 1);

                if ($photos !== null) {
                    $assigned[$candidate['key']] = $photos;
                    break;
                }
            }
        }

        $byTriple = [];

        foreach ($candidates as $candidate) {
            if ($candidate['pick'] === null) {
                $byTriple[$this->tripleKey($candidate)][] = $candidate['key'];
            }
        }

        foreach ($byTriple as $triple => $keys) {
            $pool = &$pools[$triple];
            $remaining = count($keys);

            foreach ($keys as $key) {
                $photos = $this->take($pool, $remaining);
                $remaining--;

                if ($photos !== null) {
                    $assigned[$key] = $photos;
                }
            }

            unset($pool);
        }

        // Data order, at most $maxVehicles.
        $ordered = [];

        foreach ($candidates as $candidate) {
            if (isset($assigned[$candidate['key']]) && count($ordered) < $maxVehicles) {
                $ordered[$candidate['key']] = $this->coverFirst($assigned[$candidate['key']]);
            }
        }

        return $ordered;
    }

    /**
     * @param  Candidate  $candidate
     * @return list<Photo> the matching photos: other files before the demo's, grouped by shoot, by file name
     */
    private function pool(array $candidate): array
    {
        $photos = [];

        foreach ($this->entries as $entry) {
            if (self::matches($entry['make'], $entry['model'], $entry['generation'], $candidate['make'], $candidate['model'], $candidate['generation'])) {
                $photos[] = $entry['photo'];
            }
        }

        usort($photos, fn (array $a, array $b): int => [$a['demo'], $a['group'] ?? '', $a['file']] <=> [$b['demo'], $b['group'] ?? '', $b['file']]);

        return $photos;
    }

    /**
     * Takes the photos of one vehicle out of $pool, leaving enough for the $sharing - 1 vehicles after it where possible. A whole group
     * when the manifest groups photos (the largest first, at least MIN_SHOOT), otherwise a run of consecutive files. Null when fewer
     * than MIN ungrouped photos are left.
     *
     * @param  list<Photo>  $pool
     * @return list<Photo>|null
     */
    private function take(array &$pool, int $sharing): ?array
    {
        $grouped = array_filter($pool, fn (array $photo): bool => $photo['group'] !== null);

        if ($grouped !== []) {
            // One shoot is one physical car, so a build never mixes cars; stock photography rarely has more than a few shots of one car,
            // so a shoot of MIN_SHOOT photos is enough. The largest shoot goes first (picks are served first, so the showcase account's
            // builds get the multi-photo pages); ties keep the pool order.
            $sizes = array_count_values(array_column($grouped, 'group'));
            $order = array_map('strval', array_keys($sizes));
            usort($order, fn (string $a, string $b): int => $sizes[$b] <=> $sizes[$a]); // usort is stable since PHP 8

            foreach ($order as $group) {
                $members = array_values(array_filter($pool, fn (array $photo): bool => $photo['group'] === $group));

                if (count($members) >= self::MIN_SHOOT) {
                    $taken = array_slice($members, 0, self::MAX);
                    $pool = array_values(array_filter($pool, fn (array $photo): bool => ! in_array($photo, $taken, true)));

                    return $taken;
                }
            }

            $pool = array_values(array_filter($pool, fn (array $photo): bool => $photo['group'] === null));
        }

        if (count($pool) < self::MIN) {
            return null;
        }

        $vehicles = max(1, min($sharing, intdiv(count($pool), self::MIN)));
        $size = min(self::MAX, intdiv(count($pool), $vehicles));
        $taken = array_slice($pool, 0, $size);
        $pool = array_slice($pool, $size);

        return $taken;
    }

    /**
     * Photos in the largest shoot of one car in $pool (ungrouped photos count as one shoot).
     *
     * @param  list<Photo>  $pool
     */
    private function largestShoot(array $pool): int
    {
        $sizes = array_count_values(array_map(fn (array $photo): string => $photo['group'] ?? '', $pool));

        return $sizes === [] ? 0 : max($sizes);
    }

    /**
     * The first photo becomes the cover: an exterior shot when there is one.
     *
     * @param  list<Photo>  $photos
     * @return list<Photo>
     */
    private function coverFirst(array $photos): array
    {
        $order = array_keys($photos);
        usort($order, fn (int $a, int $b): int => [self::CATEGORY_ORDER[$photos[$a]['category']] ?? 9, $a] <=> [self::CATEGORY_ORDER[$photos[$b]['category']] ?? 9, $b]);

        return array_map(fn (int $index): array => $photos[$index], $order);
    }

    /**
     * @param  Candidate  $candidate
     */
    private function tripleKey(array $candidate): string
    {
        return self::make($candidate['make']).'|'.self::normal($candidate['model']).'|'.self::normal($candidate['generation']);
    }

    /**
     * @param  array<array-key, mixed>  $entry
     * @return array{make: string, model: string, generation: string}|null
     */
    private function names(array $entry): ?array
    {
        $make = $entry['make'] ?? null;
        $model = $entry['model'] ?? null;
        $generation = $entry['generation'] ?? null;

        return is_string($make) && is_string($model) && (is_string($generation) || is_int($generation)) && $make !== '' && $model !== ''
            ? ['make' => $make, 'model' => $model, 'generation' => (string) $generation]
            : null;
    }

    private static function normal(string $value): string
    {
        return (string) preg_replace('/[^a-z0-9]/', '', Str::lower(Str::ascii($value)));
    }

    private static function make(string $make): string
    {
        $make = self::normal($make);

        return match ($make) {
            'vw' => 'volkswagen',
            'mercedes', 'mercedesamg', 'amg' => 'mercedesbenz',
            default => $make,
        };
    }

    /**
     * The names a catalogue generation goes by: the whole name ("VII (5G)", "E90/E92/E93") and each of its codes ("vii", "5g", "e92").
     * A code needs a digit or must be a Roman numeral, so words like "Typ" or "Generation" never match on their own.
     *
     * @return list<string>
     */
    private static function generationNames(string $generation): array
    {
        $names = [self::normal($generation)];

        foreach (preg_split('/[^A-Za-z0-9]+/', Str::ascii($generation)) ?: [] as $token) {
            $token = Str::lower($token);

            if ($token !== '' && (preg_match('/\d/', $token) === 1 || preg_match('/^[ivx]+$/', $token) === 1)) {
                $names[] = $token;
            }
        }

        return array_values(array_unique(array_filter($names)));
    }
}
