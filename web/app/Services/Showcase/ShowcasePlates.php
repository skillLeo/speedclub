<?php

namespace App\Services\Showcase;

use App\Services\Media\PlateBlurChoice;
use RuntimeException;

/**
 * M5.9f (ADR-509): the plate decision of every seed photo, so each sample photo goes through the upload pipeline with a decision like a
 * member's upload: `blurred` with rectangles placed on the licence plates actually in the picture (also plates already pixelated in the
 * source file and plates of background cars), or `declined` where no plate is visible. The decisions live in
 * database/data/showcase/plates.json (one line per seed photo of design/seed-photos, placed by looking at each photo); a photo folder of
 * its own (a test's) may bring a plates.json of its own.
 *
 * Avatars are square crops of a photo (DemoShowcaseSeeder::squareCrop): forCrop() moves the rectangles into the crop and declines when no
 * plate is left in it.
 *
 * @phpstan-type Region array{x: float, y: float, w: float, h: float}
 * @phpstan-type Entry array{decision: string, regions?: list<Region>, note?: string}
 */
final class ShowcasePlates
{
    public const FILE = 'data/showcase/plates.json';

    /** The smallest side of a rectangle the upload rules accept (ValidatesPlateBlur). */
    private const MIN_SIDE = 0.02;

    /** @var array<string, self> */
    private static array $loaded = [];

    /**
     * @param  array<string, Entry>  $photos
     */
    private function __construct(private readonly array $photos) {}

    /**
     * The decisions for the seed photos in $directory: its own plates.json when it has one, else the showcase data file.
     */
    public static function for(string $directory): self
    {
        $own = rtrim($directory, '/').'/plates.json';
        $path = is_file($own) ? $own : database_path(self::FILE);

        if (isset(self::$loaded[$path])) {
            return self::$loaded[$path];
        }

        $data = is_file($path) ? json_decode((string) file_get_contents($path), true) : null;

        if (! is_array($data) || ! is_array($data['photos'] ?? null)) {
            throw new RuntimeException("The plate decisions [$path] are missing or unreadable: every sample photo needs one (ADR-509).");
        }

        /** @var array<string, Entry> $photos */
        $photos = $data['photos'];

        return self::$loaded[$path] = new self($photos);
    }

    /** Forgets the files read (a test that writes another plates.json). */
    public static function flush(): void
    {
        self::$loaded = [];
    }

    public function has(string $file): bool
    {
        return isset($this->photos[self::base($file)]);
    }

    /**
     * The decision for the whole photo. A photo without an entry stays `unchecked` (the plate check lists it), never silently declined.
     */
    public function choice(string $file): PlateBlurChoice
    {
        $entry = $this->photos[self::base($file)] ?? null;

        if ($entry === null) {
            return PlateBlurChoice::unchecked();
        }

        $regions = $this->regions($entry);

        return $entry['decision'] === 'blurred' && $regions !== [] ? PlateBlurChoice::blurred($regions) : PlateBlurChoice::declined();
    }

    /**
     * The decision for a crop of the photo (pixels $x, $y, $width × $height of a $photoWidth × $photoHeight picture): the rectangles
     * moved into the crop, cut at its edges; declined when none reaches into it.
     */
    public function forCrop(string $file, int $photoWidth, int $photoHeight, int $x, int $y, int $width, int $height): PlateBlurChoice
    {
        $entry = $this->photos[self::base($file)] ?? null;

        if ($entry === null || $photoWidth < 1 || $photoHeight < 1 || $width < 1 || $height < 1) {
            return PlateBlurChoice::unchecked();
        }

        $moved = [];

        foreach ($this->regions($entry) as $region) {
            $left = max(0.0, ($region['x'] * $photoWidth - $x) / $width);
            $top = max(0.0, ($region['y'] * $photoHeight - $y) / $height);
            $right = min(1.0, (($region['x'] + $region['w']) * $photoWidth - $x) / $width);
            $bottom = min(1.0, (($region['y'] + $region['h']) * $photoHeight - $y) / $height);

            if ($right <= $left || $bottom <= $top) {
                continue;
            }

            $moved[] = self::atLeastMinimum($left, $top, $right - $left, $bottom - $top);
        }

        return $moved === [] ? PlateBlurChoice::declined() : PlateBlurChoice::blurred($moved);
    }

    /**
     * The square DemoShowcaseSeeder cuts for an avatar: [x, y, side] in pixels around the focal point.
     *
     * @return array{0: int, 1: int, 2: int}
     */
    public static function squareAround(int $width, int $height, ?float $focalX, ?float $focalY): array
    {
        $side = min($width, $height);
        $x = (int) max(0, min($width - $side, ($focalX ?? 0.5) * $width - $side / 2));
        $y = (int) max(0, min($height - $side, ($focalY ?? 0.5) * $height - $side / 2));

        return [$x, $y, $side];
    }

    /**
     * The seed file a media.sample_source names ("vehicle:bmw-g82-01.jpg#graded2" → "bmw-g82-01.jpg"); null for none.
     */
    public static function fileOf(?string $sampleSource): ?string
    {
        if ($sampleSource === null || ! str_contains($sampleSource, ':')) {
            return null;
        }

        $file = explode('#', substr($sampleSource, strpos($sampleSource, ':') + 1))[0];

        return $file === '' ? null : $file;
    }

    /**
     * @param  Entry  $entry
     * @return list<Region>
     */
    private function regions(array $entry): array
    {
        $regions = [];

        foreach ($entry['regions'] ?? [] as $region) {
            $regions[] = self::atLeastMinimum((float) $region['x'], (float) $region['y'], (float) $region['w'], (float) $region['h']);
        }

        return array_slice($regions, 0, 8);
    }

    /**
     * A rectangle inside the photo with sides of at least MIN_SIDE (grown around its centre, then pushed back inside).
     *
     * @return Region
     */
    private static function atLeastMinimum(float $x, float $y, float $w, float $h): array
    {
        $grow = function (float $start, float $size): array {
            if ($size >= self::MIN_SIDE) {
                return [max(0.0, $start), min($size, 1.0)];
            }

            $start = max(0.0, min(1.0 - self::MIN_SIDE, $start - (self::MIN_SIDE - $size) / 2));

            return [$start, self::MIN_SIDE];
        };

        [$x, $w] = $grow($x, $w);
        [$y, $h] = $grow($y, $h);

        return ['x' => round($x, 4), 'y' => round($y, 4), 'w' => round(min($w, 1.0 - $x), 4), 'h' => round(min($h, 1.0 - $y), 4)];
    }

    private static function base(string $file): string
    {
        return basename($file);
    }
}
