<?php

namespace App\Services\Signature;

use App\Services\PublicPages\OgImageCanvas;
use App\Support\DesignTokens;
use GdImage;
use RuntimeException;

/**
 * Draws a VEH-07 share card with GD [SIG sig.share_cards] (02_PRODUCT_SPEC §5, m2.7-contract §1): the photo, the make, the name, the
 * data the member chose, the client's wordmark as delivered (brand layer, 03_DESIGN_SYSTEM §2) and the QR code black on white with its
 * quiet zone, the wordmark under it on the same white panel, never inside the code (§3.4). Fonts from resources/fonts, as the OG images
 * (Archivo SemiExpanded for the make and the name, Archivo Condensed for numerals, Inter for people and text); text a font cannot draw is
 * left out (OgImageCanvas). Every colour is a design token (DesignTokens), the photo scrims included.
 *
 * R5-2e VEH-07 2.0 (12_CLIENT_ROUND_5 "share card contract"), three templates on both formats:
 * - `band`: the square card keeps the photo in its upper PHOTO_BOXES part with only the gauge on its lower right corner (on its disc);
 *   a solid band (bg-canvas of the carbon or the light theme) holds the text and the QR panel. The story card is the photo edge to edge,
 *   the data at the bottom.
 * - `poster`: the photo edge to edge under a dark scrim, the name large at the top of the safe area, data and QR at the bottom; dark.
 * - `frame`: the photo inset on a solid ground (rounded like inset hero media) with a caption block under it; takes the theme.
 *
 * Layout rules (the contract's 1–5): every text, the gauge and the QR keep SQUARE_SAFE from the square card's edges; on the story nothing
 * but the photo and the scrim lies in the top or bottom STORY_SAFE. The name shrinks to its minimum, then wraps onto a second line at a
 * word boundary, and only then ends in "…". The QR keeps QR_MIN and its quiet zone. Nothing overlaps: the place of every element comes
 * from layout(), which the tests read. Rule 6: no line under FLOOR_PX (the own text wraps to two lines, the mods line drops whole names).
 */
final class ShareCardCanvas
{
    /** @var array<string, array{0: int, 1: int}> width and height per format */
    public const FORMATS = ['story' => [1080, 1920], 'square' => [1080, 1080]];

    /** R5-2e: the photo box per template and format, width and height (the app's crop shows exactly this aspect). */
    public const PHOTO_BOXES = [
        'band' => ['square' => [1080, 600], 'story' => [1080, 1920]],
        'poster' => ['square' => [1080, 1080], 'story' => [1080, 1920]],
        'frame' => ['square' => [984, 600], 'story' => [984, 1080]],
    ];

    /** CF-6: the square band card's photo height; the band takes the rest. */
    public const SQUARE_PHOTO_HEIGHT = 600;

    /** Rule 1: what every text, the gauge and the QR keep from the square card's edges. */
    public const SQUARE_SAFE = 64;

    /** Rule 1: the story's top and bottom, which the story apps' bars cover: only the photo and the scrim lie there. */
    public const STORY_SAFE = 250;

    /** Rule 3: the QR code's least side, quiet zone included. */
    public const QR_MIN = ['square' => 200, 'story' => 240];

    /** GD draws a size in points at 96 dpi: the pixels of the em per point. */
    public const PX_PER_POINT = 96 / 72;

    /**
     * Rule 6 (lead review r1): the legibility floor on the 1080-wide canvas, in pixels of the em: every line, the name, the gauge's own
     * captions. As GD sizes: 20, 33 and 17 points.
     */
    public const FLOOR_PX = ['line' => 26, 'title' => 44, 'gauge' => 22];

    /** display.title (09 §4.2, §8.5): the make and the name in Archivo SemiExpanded. */
    private const FONT_DISPLAY = 'ArchivoSemiExpanded-SemiBold.ttf';

    /** The spec numerals in Archivo Condensed, as the SpecStrip. */
    private const FONT_NUMERALS = 'ArchivoCondensed-SemiBold.ttf';

    private const FONT_TEXT = 'Inter-Medium.ttf';

    /** R5DQ-05: the lines that shrink to their floor before the name, the make and the specs do. */
    private const MINOR_LINES = ['text', 'mods', 'handle'];

    /** Between a text column and the gauge or the QR panel beside it. */
    private const COLUMN_GAP = 40;

    /** The frame's photo: radius 20 of inset hero media (03 §2). */
    private const FRAME_RADIUS = 20;

    /** The wordmark's aspect (brand/logo-wide-*-640.png, 640 × 169). */
    private const LOGO_RATIO = 169 / 640;

    /**
     * The fixed geometry of each template and format:
     * - photo: x, y of the photo box (its size is PHOTO_BOXES);
     * - qr: x, y, side of the code (quiet zone included), height of the wordmark strip under it;
     * - logo: x, bottom, width of the wordmark alone when the card has no code;
     * - gauge: centre x, centre y and radius of the dial, always on the photo on its scrim disc;
     * - stacks: the text regions, left, top, right, bottom and alignment, with the lines each holds;
     * - sizes: display and minimum size per line.
     *
     * @var array<string, array<string, array{photo: array{0: int, 1: int}, qr: array{0: int, 1: int, 2: int, 3: int}, logo: array{0: int, 1: int, 2: int}, gauge: array{0: int, 1: int, 2: int}, stacks: array<string, array{0: int, 1: int, 2: int, 3: int, 4: string, 5: list<string>}>, sizes: array<string, array{0: int, 1: int}>, ground: bool}>>
     */
    private const CELLS = [
        'band' => [
            'square' => [
                'photo' => [0, 0],
                'qr' => [800, 694, 216, 44],
                'logo' => [816, 866, 200],
                'gauge' => [890, 458, 96],
                'stacks' => ['main' => [64, 624, 1016, 1016, 'center', ['head', 'title', 'specs', 'mods', 'handle', 'text']]],
                'sizes' => ['eyebrow' => [30, 20], 'dex' => [26, 20], 'title' => [64, 33], 'specs' => [32, 24], 'mods' => [26, 20], 'handle' => [26, 20], 'text' => [26, 20]],
                'ground' => true,
            ],
            'story' => [
                'photo' => [0, 0],
                'qr' => [752, 1354, 264, 52],
                'logo' => [736, 1670, 280],
                'gauge' => [856, 410, 130],
                'stacks' => ['main' => [64, 640, 1016, 1670, 'bottom', ['head', 'title', 'specs', 'mods', 'handle', 'text']]],
                'sizes' => ['eyebrow' => [38, 24], 'dex' => [32, 22], 'title' => [96, 48], 'specs' => [40, 26], 'mods' => [32, 20], 'handle' => [32, 20], 'text' => [32, 20]],
                'ground' => false,
            ],
        ],
        'poster' => [
            'square' => [
                'photo' => [0, 0],
                'qr' => [808, 764, 208, 44],
                'logo' => [816, 1016, 200],
                'gauge' => [890, 526, 96],
                'stacks' => [
                    'head' => [64, 64, 1016, 380, 'top', ['head', 'title']],
                    'data' => [64, 680, 1016, 1016, 'bottom', ['specs', 'mods', 'handle', 'text']],
                ],
                'sizes' => ['eyebrow' => [30, 20], 'dex' => [26, 20], 'title' => [80, 33], 'specs' => [32, 24], 'mods' => [26, 20], 'handle' => [26, 20], 'text' => [26, 20]],
                'ground' => false,
            ],
            'story' => [
                'photo' => [0, 0],
                'qr' => [752, 1354, 264, 52],
                'logo' => [736, 1670, 280],
                'gauge' => [876, 1182, 110],
                'stacks' => [
                    'head' => [64, 250, 1016, 900, 'top', ['head', 'title']],
                    'data' => [64, 1350, 1016, 1670, 'bottom', ['specs', 'mods', 'handle', 'text']],
                ],
                'sizes' => ['eyebrow' => [38, 24], 'dex' => [32, 22], 'title' => [112, 56], 'specs' => [40, 26], 'mods' => [32, 20], 'handle' => [32, 20], 'text' => [32, 20]],
                'ground' => false,
            ],
        ],
        'frame' => [
            'square' => [
                'photo' => [48, 48],
                'qr' => [816, 728, 200, 40],
                'logo' => [816, 1016, 200],
                'gauge' => [890, 506, 96],
                'stacks' => ['main' => [64, 668, 1016, 1016, 'center', ['head', 'title', 'specs', 'mods', 'handle', 'text']]],
                'sizes' => ['eyebrow' => [26, 20], 'dex' => [24, 20], 'title' => [56, 33], 'specs' => [28, 24], 'mods' => [24, 20], 'handle' => [24, 20], 'text' => [24, 20]],
                'ground' => true,
            ],
            'story' => [
                'photo' => [48, 48],
                'qr' => [776, 1273, 240, 44],
                'logo' => [736, 1670, 280],
                'gauge' => [876, 964, 110],
                'stacks' => ['main' => [64, 1160, 1016, 1670, 'center', ['head', 'title', 'specs', 'mods', 'handle', 'text']]],
                'sizes' => ['eyebrow' => [34, 20], 'dex' => [30, 20], 'title' => [72, 33], 'specs' => [36, 26], 'mods' => [28, 20], 'handle' => [28, 20], 'text' => [28, 20]],
                'ground' => true,
            ],
        ],
    ];

    /** The scrim disc around a gauge on the photo. */
    private const DISC = 30;

    /** @var array<string, array{0: int, 1: int}> ascent and descent per font and size */
    private array $metrics = [];

    /** @var array<string, int> measured widths, by font, size and text (the size ladder measures the same strings again) */
    private array $widths = [];

    public function __construct(private readonly OgImageCanvas $og) {}

    /**
     * R5-2e: the photo box of each template and format, width and height (the contract's table; the app's crop uses the same).
     *
     * @return array<string, array<string, array{0: int, 1: int}>>
     */
    public static function photoBoxes(): array
    {
        return self::PHOTO_BOXES;
    }

    /**
     * Rule 6: the smallest GD size (points) whose em is at least the floor in pixels.
     */
    public static function floorPoints(string $kind): int
    {
        return (int) ceil(self::FLOOR_PX[$kind] / self::PX_PER_POINT);
    }

    /**
     * The gauge's total, stage and name sizes (points) for a dial of $radius; the captions never under the floor (rule 6).
     *
     * @return array{0: int, 1: int, 2: int}
     */
    public static function gaugeSizes(int $radius): array
    {
        $floor = self::floorPoints('gauge');

        return [max(self::floorPoints('line'), (int) round($radius * 0.42)), max($floor, (int) round($radius * 0.13)), max($floor, (int) round($radius * 0.11))];
    }

    /**
     * The QR panel's place, x, y, width and height (the code is the top square of it, its quiet zone included): for the tests.
     *
     * @return array{0: int, 1: int, 2: int, 3: int}
     */
    public static function qrPanel(string $format, string $template = 'band'): array
    {
        [$x, $y, $side, $caption] = self::cell($format, $template)['qr'];

        return [$x, $y, $side, $side + $caption];
    }

    /**
     * CF-6: the square band card's QR panel (qrPanel('square')).
     *
     * @return array{0: int, 1: int, 2: int, 3: int}
     */
    public static function squareQrPanel(): array
    {
        return self::qrPanel('square');
    }

    /**
     * The window of the photo a card draws, x, y, width and height in the photo's pixels (R5-2e crop): zoom 1 is the largest window of
     * the box's aspect that fits the photo, zoom 3 a third of it; the centre is clamped so the window stays inside the photo.
     *
     * @return array{0: int, 1: int, 2: int, 3: int}
     */
    public static function cropWindow(int $sourceWidth, int $sourceHeight, int $boxWidth, int $boxHeight, float $zoom = 1.0, float $centreX = 0.5, float $centreY = 0.5): array
    {
        $zoom = max(1.0, min(3.0, $zoom));
        $aspect = $boxWidth / max(1, $boxHeight);

        if ($sourceWidth / max(1, $sourceHeight) > $aspect) {
            $height = $sourceHeight / $zoom;
            $width = $height * $aspect;
        } else {
            $width = $sourceWidth / $zoom;
            $height = $width / $aspect;
        }

        $width = max(1, min($sourceWidth, (int) round($width)));
        $height = max(1, min($sourceHeight, (int) round($height)));
        $x = (int) round(($sourceWidth * max(0.0, min(1.0, $centreX))) - ($width / 2));
        $y = (int) round(($sourceHeight * max(0.0, min(1.0, $centreY))) - ($height / 2));

        return [max(0, min($x, $sourceWidth - $width)), max(0, min($y, $sourceHeight - $height)), $width, $height];
    }

    /**
     * @param  string  $photo  image bytes of the photo's largest variant
     * @param  float|null  $focalX  the crop's centre in the photo (the member's, else the focal point); null for the middle
     * @param  string|null  $qr  PNG of the code, square, with its quiet zone; null draws no panel
     * @param  array{total: int, max: int, stage: string, label: string}|null  $score  M5.9c: the Build Score gauge; null draws none
     * @param  string|null  $dex  M5.9b/c: "Dex Nr. 0087" beside the make
     * @param  string  $theme  CF-6: `dark` or `light`, for the square band and the frame
     * @param  string  $template  R5-2e: `band`, `poster` or `frame`
     * @param  float  $zoom  R5-2e: 1 to 3
     * @param  string|null  $text  R5-2e: the member's own line
     * @param  array{label: string, items: list<string>}|null  $mods  R5-2e: "12 Mods" and the names that may follow it
     * @return string PNG bytes
     */
    public function draw(string $format, string $photo, ?float $focalX, ?float $focalY, ?string $eyebrow, string $title, string $specs, ?string $handle, ?string $qr, ?array $score = null, ?string $dex = null, string $theme = 'dark', string $template = 'band', float $zoom = 1.0, ?string $text = null, ?array $mods = null): string
    {
        [$width, $height] = self::FORMATS[$format] ?? throw new RuntimeException("Unknown share card format [$format].");
        $template = isset(self::PHOTO_BOXES[$template]) ? $template : 'band';
        $cell = self::cell($format, $template);
        // The poster and the story band lie on the photo and stay dark; the square band and the frame take the theme.
        $tokens = $cell['ground'] && $theme === 'light' ? 'light' : 'carbon';
        $layout = $this->layout($format, $template, [
            'eyebrow' => $eyebrow, 'title' => $title, 'specs' => $specs, 'handle' => $handle, 'dex' => $dex, 'text' => $text, 'mods' => $mods,
            'qr' => $qr !== null, 'score' => $score !== null, 'score_labels' => $score === null ? [] : [$score['stage'], $score['label']],
        ]);

        $image = imagecreatetruecolor(max(1, $width), max(1, $height));

        if (! $image instanceof GdImage) {
            throw new RuntimeException('GD could not create the share card.');
        }

        imagealphablending($image, true);
        [$boxWidth, $boxHeight] = self::PHOTO_BOXES[$template][$format];
        [$photoX, $photoY] = $cell['photo'];

        if ($cell['ground']) {
            imagefilledrectangle($image, 0, 0, $width - 1, $height - 1, $this->token($image, 'bg-canvas', $tokens));
        }

        $this->photo($image, $photo, $photoX, $photoY, $boxWidth, $boxHeight, $zoom, $focalX ?? 0.5, $focalY ?? 0.5);

        if ($template === 'frame') {
            $this->roundCorners($image, $photoX, $photoY, $boxWidth, $boxHeight, self::FRAME_RADIUS, 'bg-canvas', $tokens);
        } elseif ($template === 'band' && $format === 'square') {
            imageline($image, 0, $boxHeight, $width - 1, $boxHeight, $this->token($image, 'border-subtle', $tokens));
        } elseif ($template === 'band') {
            // The story band: scrim.photo, one even ramp from clear to the stage at the card's bottom edge (the story bars' zone), so the
            // photo stays visible behind the data instead of going black from two thirds down; and a light scrim at the top.
            $this->scrim($image, $width, (int) round($height * 0.36), $height, 'scrim-photo-start', 'scrim-photo-end');
            $this->scrim($image, $width, 0, 220, 'scrim-top-start', 'scrim-top-end');
        } else {
            // The poster: dark at the top under the name and at the bottom under the data; the photo keeps its middle.
            $this->scrim($image, $width, 0, (int) round($height * ($format === 'story' ? 0.46 : 0.5)), 'overlay-photo-scrim-end', 'scrim-photo-start');
            $middle = (int) round($height * ($format === 'story' ? 0.5 : 0.48));
            $dark = (int) round($height * ($format === 'story' ? 0.7 : 0.74));
            $this->scrim($image, $width, $middle, $dark, 'scrim-photo-start', 'overlay-photo-scrim-end');
            $this->scrim($image, $width, $dark, $height, 'overlay-photo-scrim-end', 'scrim-photo-end');
        }

        if ($score !== null && isset($layout['boxes']['gauge'])) {
            [$cx, $cy, $radius] = $cell['gauge'];
            $this->gauge($image, $cx, $cy, $radius, $score);
        }

        if ($qr !== null) {
            [$x, $y, $side, $caption] = $cell['qr'];
            $this->drawQrPanel($image, $qr, $x, $y, $side, $caption);

            if ($tokens === 'light') {
                imagerectangle($image, $x - 1, $y - 1, $x + $side, $y + $side + $caption + 1, $this->token($image, 'border-default', $tokens));
            }
        } else {
            [$x, $bottom, $logoWidth] = $cell['logo'];
            $logo = $tokens === 'light' ? 'brand/logo-wide-black-640.png' : 'brand/logo-wide-white-640.png';
            $this->logo($image, $logo, $x, $bottom - (int) round($logoWidth * self::LOGO_RATIO), $logoWidth);
        }

        $onPhoto = ! $cell['ground'];

        foreach ($layout['lines'] as $line) {
            $tone = $onPhoto ? ($line['tone'] === 'secondary' ? 'on-photo-secondary' : 'on-photo-primary') : 'text-'.$line['tone'];
            $color = $this->token($image, $tone, $onPhoto ? 'carbon' : $tokens);
            imagettftext($image, $line['size'], 0, $line['x'], $line['baseline'], $color, resource_path('fonts/'.$line['font']), str_replace('&', '&#38;', $line['text']));
        }

        ob_start();
        imagepng($image, null, 6);

        return (string) ob_get_clean();
    }

    /**
     * Where everything goes (rules 1–4), without drawing: the photo box, a box per element ([left, top, right, bottom], the right and
     * bottom edge exclusive) and the text lines with their font, size and baseline. The strings are cleaned as for drawing.
     *
     * @param  array{eyebrow?: string|null, title?: string, specs?: string, handle?: string|null, dex?: string|null, text?: string|null, mods?: array{label: string, items: list<string>}|null, qr?: bool, score?: bool, score_labels?: list<string>}  $content
     * @return array{photo: array{0: int, 1: int, 2: int, 3: int}, boxes: array<string, array{0: int, 1: int, 2: int, 3: int}>, lines: list<array{key: string, font: string, size: int, x: int, baseline: int, text: string, tone: string}>, title: list<string>, gauge: array{0: int, 1: int, 2: int}|null}
     */
    public function layout(string $format, string $template, array $content): array
    {
        $cell = self::cell($format, $template);
        [$boxWidth, $boxHeight] = self::PHOTO_BOXES[$template][$format];
        [$photoX, $photoY] = $cell['photo'];
        $boxes = [];

        if (($content['qr'] ?? false) === true) {
            [$x, $y, $side, $caption] = $cell['qr'];
            $boxes['qr'] = [$x, $y, $x + $side, $y + $side + $caption];
        } else {
            [$x, $bottom, $logoWidth] = $cell['logo'];
            $boxes['logo'] = [$x, $bottom - (int) round($logoWidth * self::LOGO_RATIO), $x + $logoWidth, $bottom];
        }

        if (($content['score'] ?? false) === true) {
            $boxes['gauge'] = $this->gaugeBox($cell['gauge'], $content['score_labels'] ?? []);
        }

        $clean = fn (?string $value): string => $value === null ? '' : $this->og->sanitise($value);
        $mods = $content['mods'] ?? null;
        $strings = [
            'eyebrow' => $clean($content['eyebrow'] ?? null),
            'dex' => $clean($content['dex'] ?? null),
            'title' => $clean($content['title'] ?? ''),
            'specs' => $clean($content['specs'] ?? ''),
            'handle' => $clean($content['handle'] ?? null),
            'text' => $clean($content['text'] ?? null),
        ];
        $modItems = $mods === null ? [] : array_values(array_filter(array_map($clean, $mods['items']), fn (string $item): bool => $item !== ''));
        $modLabel = $mods === null ? '' : $clean($mods['label']);
        $modLine = $modLabel === '' ? '' : $this->modsLine($modLabel, $modItems);

        $lines = [];
        $title = [];

        foreach ($cell['stacks'] as [$left, $top, $right, $bottom, $align, $keys]) {
            // The column ends before the gauge and the panel where they share its height.
            foreach ($boxes as $box) {
                if ($box[1] < $bottom && $box[3] > $top && $box[0] > $left) {
                    $right = min($right, $box[0] - self::COLUMN_GAP);
                }
            }

            $stack = $this->stack($keys, $strings, $modLine, $cell['sizes'], $left, $top, $right, $bottom, $align);

            foreach ($stack['lines'] as $line) {
                $lines[] = $line;
            }

            foreach ($stack['boxes'] as $key => $box) {
                $boxes[$key] = $box;
            }

            if ($stack['title'] !== []) {
                $title = $stack['title'];
            }
        }

        return [
            'photo' => [$photoX, $photoY, $photoX + $boxWidth, $photoY + $boxHeight],
            'boxes' => $boxes,
            'lines' => $lines,
            'title' => $title,
            // The gauge's total, stage and name sizes (points), for the floor.
            'gauge' => isset($boxes['gauge']) ? self::gaugeSizes($cell['gauge'][2]) : null,
        ];
    }

    /**
     * R5DQ-13/20: the mods line, chosen once for every template and format: the count, then the build's first two installed mods, or
     * the first, or the count alone ("12 Mods"), whichever is the longest that fits every card's mods column at that card's display size
     * for the line. The same build shows the same parts on every card, and the line never has to shrink on its own: it shares its size
     * with the @username and the own text (MINOR_LINES), so it is never the smallest line on the card. Names are never cut.
     *
     * @param  list<string>  $items
     */
    public function modsLine(string $label, array $items): string
    {
        $path = resource_path('fonts/'.self::FONT_TEXT);
        $columns = self::modsColumns();

        for ($count = min(2, count($items)); $count > 0; $count--) {
            $line = implode(' · ', [$label, ...array_slice($items, 0, $count)]);
            $fits = true;

            foreach ($columns as [$width, $size]) {
                if ($this->width($path, $size, $line) > $width) {
                    $fits = false;

                    break;
                }
            }

            if ($fits) {
                return $line;
            }
        }

        return $label;
    }

    /**
     * The column that holds the mods line on each template and format, with the QR panel and the gauge beside it, and the line's
     * display size there.
     *
     * @return list<array{0: int, 1: int}> width and size (points)
     */
    public static function modsColumns(): array
    {
        $columns = [];

        foreach (self::CELLS as $formats) {
            foreach ($formats as $cell) {
                [$qrX, $qrY, $side, $caption] = $cell['qr'];
                [$cx, $cy, $radius] = $cell['gauge'];
                $outer = $radius + self::DISC;
                $obstacles = [[$qrX, $qrY, $qrY + $side + $caption], [$cx - $outer, $cy - $outer, $cy + $outer]];

                foreach ($cell['stacks'] as [$left, $top, $right, $bottom, , $keys]) {
                    if (! in_array('mods', $keys, true)) {
                        continue;
                    }

                    foreach ($obstacles as [$x, $from, $to]) {
                        if ($from < $bottom && $to > $top) {
                            $right = min($right, $x - self::COLUMN_GAP);
                        }
                    }

                    $columns[] = [$right - $left, $cell['sizes']['mods'][0]];
                }
            }
        }

        return $columns;
    }

    /**
     * @return array{photo: array{0: int, 1: int}, qr: array{0: int, 1: int, 2: int, 3: int}, logo: array{0: int, 1: int, 2: int}, gauge: array{0: int, 1: int, 2: int}, stacks: array<string, array{0: int, 1: int, 2: int, 3: int, 4: string, 5: list<string>}>, sizes: array<string, array{0: int, 1: int}>, ground: bool}
     */
    private static function cell(string $format, string $template): array
    {
        return self::CELLS[$template][$format] ?? throw new RuntimeException("Unknown share card [$template/$format].");
    }

    /**
     * The gauge's box: its scrim disc, widened where a caption is wider than the disc's chord.
     *
     * @param  array{0: int, 1: int, 2: int}  $gauge
     * @param  list<string>  $labels  the stage and the name
     * @return array{0: int, 1: int, 2: int, 3: int}
     */
    private function gaugeBox(array $gauge, array $labels): array
    {
        [$cx, $cy, $radius] = $gauge;
        $outer = $radius + self::DISC;
        $box = [$cx - $outer, $cy - $outer, $cx + $outer, $cy + $outer];

        foreach ($this->gaugeCaptions($cy, $radius, $labels) as [$text, $size, $baseline]) {
            $half = intdiv($this->width(resource_path('fonts/'.self::FONT_TEXT), $size, $text) + 1, 2);
            [$ascent, $descent] = $this->metrics(self::FONT_TEXT, $size);
            $box = [min($box[0], $cx - $half), min($box[1], $baseline - $ascent), max($box[2], $cx + $half), max($box[3], $baseline + $descent)];
        }

        return $box;
    }

    /**
     * The stage and the name under the gauge's total: text, size and baseline of each.
     *
     * @param  list<string>  $labels
     * @return list<array{0: string, 1: int, 2: int}>
     */
    private function gaugeCaptions(int $cy, int $radius, array $labels): array
    {
        [, $stageSize, $labelSize] = self::gaugeSizes($radius);
        $baseline = $cy + (int) round($radius * 0.52);
        $captions = [];

        foreach ($labels as $index => $label) {
            $size = $index === 0 ? $stageSize : $labelSize;
            $text = $this->og->sanitise($index === 0 ? mb_strtoupper($label) : $label);
            $baseline += $this->metrics(self::FONT_TEXT, $size)[0] + ($index === 0 ? max(4, (int) round($radius * 0.05)) : 2);
            $captions[] = [$text, $size, $baseline];
        }

        return $captions;
    }

    /**
     * A column of lines in its region: the largest sizes at which all of them fit its height (each line shrinks within its own range
     * first, rule 2 for the name), aligned to the region's top, centre or bottom.
     *
     * @param  list<string>  $keys
     * @param  array<string, string>  $strings
     * @param  array<string, array{0: int, 1: int}>  $sizes
     * @return array{lines: list<array{key: string, font: string, size: int, x: int, baseline: int, text: string, tone: string}>, boxes: array<string, array{0: int, 1: int, 2: int, 3: int}>, title: list<string>}
     */
    private function stack(array $keys, array $strings, string $modLine, array $sizes, int $left, int $top, int $right, int $bottom, string $align): array
    {
        $width = max(1, $right - $left);
        $available = $bottom - $top;
        $rows = [];

        // The display sizes step down to each line's minimum, which is never under the legibility floor (rule 6): first the own text,
        // the mods and the @username (MINOR_LINES) down to theirs, only then the name, the make and the specs (R5DQ-05: the hero data
        // never ends up smaller than the lines under it). The geometry gives every column room for its longest content at the
        // minimums (the tests hold every combination to that).
        $ladder = [1.0, 0.94, 0.88, 0.82, 0.76, 0.7, 0.64, 0.58, 0.52, 0.46, 0.4, 0.34, 0.28];
        $steps = [];

        foreach ($ladder as $minor) {
            $steps[] = [1.0, $minor];
        }

        foreach (array_slice($ladder, 1) as $major) {
            $steps[] = [$major, 0.28];
        }

        foreach ($steps as [$major, $minor]) {
            $rows = $this->rows($keys, $strings, $modLine, $sizes, $width, $major, $minor);

            if ($this->height($rows) <= $available) {
                break;
            }
        }

        $total = $this->height($rows);
        $y = match ($align) {
            'bottom' => $bottom - $total,
            'center' => $top + intdiv(max(0, $available - $total), 2),
            default => $top,
        };

        $lines = [];
        $boxes = [];
        $title = [];

        foreach ($rows as $index => $row) {
            $y += $index === 0 ? 0 : $row['gap'];
            $baseline = $y + $row['ascent'];
            $x = $left;

            foreach ($row['parts'] as $part) {
                $lines[] = ['key' => $row['key'], 'font' => $part['font'], 'size' => $row['size'], 'x' => $x, 'baseline' => $baseline, 'text' => $part['text'], 'tone' => $part['tone']];
                $partWidth = $this->width(resource_path('fonts/'.$part['font']), $part['size'] ?? $row['size'], $part['text']);
                $boxes[$part['box']] = [$x, $y, $x + $partWidth, $y + $row['ascent'] + $row['descent']];

                if ($part['size'] !== null) {
                    // A part in its own size on the row (the Dex number beside the make) keeps the row's baseline.
                    $last = array_key_last($lines);
                    $lines[$last]['size'] = $part['size'];
                }

                $x += $partWidth + $part['after'];
            }

            if ($row['key'] === 'title') {
                $title[] = $row['parts'][0]['text'];
            }

            $y += $row['ascent'] + $row['descent'];
        }

        return ['lines' => $lines, 'boxes' => $boxes, 'title' => $title];
    }

    /**
     * @param  list<array{gap: int, ascent: int, descent: int}>  $rows
     */
    private function height(array $rows): int
    {
        $height = 0;

        foreach ($rows as $index => $row) {
            $height += ($index === 0 ? 0 : $row['gap']) + $row['ascent'] + $row['descent'];
        }

        return $height;
    }

    /**
     * The rows of a column at one step of the size ladder: $major scales the display sizes of the name, the make and the specs, $minor
     * those of MINOR_LINES, never under a line's minimum; no minimum is under the legibility floor.
     *
     * @param  list<string>  $keys
     * @param  array<string, string>  $strings
     * @param  array<string, array{0: int, 1: int}>  $sizes
     * @return list<array{key: string, size: int, gap: int, ascent: int, descent: int, parts: list<array{text: string, font: string, tone: string, box: string, size: int|null, after: int}>}>
     */
    private function rows(array $keys, array $strings, string $modLine, array $sizes, int $width, float $major, float $minor): array
    {
        $size = function (string $key) use ($sizes, $major, $minor): array {
            [$display, $minimum] = $sizes[$key];
            $minimum = max($minimum, self::floorPoints($key === 'title' ? 'title' : 'line'));
            $factor = in_array($key, self::MINOR_LINES, true) ? $minor : $major;

            return [max($minimum, (int) round($display * $factor)), $minimum];
        };
        $rows = [];

        foreach ($keys as $key) {
            if ($key === 'head') {
                foreach ($this->headRows($strings['eyebrow'], $strings['dex'], $size('eyebrow'), $size('dex'), $width) as $row) {
                    $rows[] = $row;
                }

                continue;
            }

            if ($key === 'mods') {
                if ($modLine === '') {
                    continue;
                }

                // The line modsLine() chose fits every column at its display size, so it never shrinks on its own and never cuts a name.
                [$modSize, $modMinimum] = $size('mods');
                [$fitted, $parts] = $this->fitSingle($modLine, self::FONT_TEXT, $modSize, $modMinimum, $width);
                $rows[] = $this->row('mods', [[$parts[0], self::FONT_TEXT, 'secondary', 'mods']], $fitted, self::FONT_TEXT);

                continue;
            }

            $text = $strings[$key] ?? '';

            if ($text === '') {
                continue;
            }

            [$display, $minimum] = $size($key);
            [$font, $tone, $maxLines] = match ($key) {
                'title' => [self::FONT_DISPLAY, 'primary', 2],
                'specs' => [self::FONT_NUMERALS, 'primary', 1],
                'handle' => [self::FONT_TEXT, 'secondary', 1],
                default => [self::FONT_TEXT, 'primary', 2],
            };

            if ($font !== self::FONT_TEXT && ! $this->archivoCovers($text)) {
                $font = self::FONT_TEXT;
            }

            [$fitted, $parts] = $maxLines === 1
                ? $this->fitSingle($text, $font, $display, $minimum, $width)
                : $this->fitLines($text, $font, $display, $minimum, $width);

            foreach ($parts as $index => $part) {
                $row = $this->row($key, [[$part, $font, $tone, $key.'.'.$index]], $fitted, $font);

                if ($index > 0) {
                    // The second line of a wrapped name or text: a tight leading.
                    $row['gap'] = max(0, (int) round($fitted * 0.12));
                }

                $rows[] = $row;
            }
        }

        return $rows;
    }

    /**
     * The make with the Dex number after it on one row when both fit, else the Dex number above the make.
     *
     * @param  array{0: int, 1: int}  $eyebrowSize
     * @param  array{0: int, 1: int}  $dexSize
     * @return list<array{key: string, size: int, gap: int, ascent: int, descent: int, parts: list<array{text: string, font: string, tone: string, box: string, size: int|null, after: int}>}>
     */
    private function headRows(string $eyebrow, string $dex, array $eyebrowSize, array $dexSize, int $width): array
    {
        $eyebrowFont = $this->archivoCovers($eyebrow) ? self::FONT_DISPLAY : self::FONT_TEXT;

        if ($eyebrow === '' && $dex === '') {
            return [];
        }

        if ($eyebrow === '') {
            [$size, $parts] = $this->fitSingle($dex, self::FONT_NUMERALS, $dexSize[0], $dexSize[1], $width);

            return [$this->row('dex', [[$parts[0], self::FONT_NUMERALS, 'secondary', 'dex']], $size, self::FONT_NUMERALS)];
        }

        [$size, $parts] = $this->fitSingle($eyebrow, $eyebrowFont, $eyebrowSize[0], $eyebrowSize[1], $width);
        $row = $this->row('eyebrow', [[$parts[0], $eyebrowFont, 'primary', 'eyebrow']], $size, $eyebrowFont);

        if ($dex === '') {
            return [$row];
        }

        $space = (int) round($size * 0.9);
        $dexWidth = $this->width(resource_path('fonts/'.self::FONT_NUMERALS), $dexSize[0], $dex);

        if ($this->width(resource_path('fonts/'.$eyebrowFont), $size, $parts[0]) + $space + $dexWidth <= $width) {
            $row['parts'] = [
                ['text' => $parts[0], 'font' => $eyebrowFont, 'tone' => 'primary', 'box' => 'eyebrow', 'size' => null, 'after' => $space],
                ['text' => $dex, 'font' => self::FONT_NUMERALS, 'tone' => 'secondary', 'box' => 'dex', 'size' => $dexSize[0], 'after' => 0],
            ];
            [$ascent, $descent] = $this->metrics(self::FONT_NUMERALS, $dexSize[0]);
            $row['ascent'] = max($row['ascent'], $ascent);
            $row['descent'] = max($row['descent'], $descent);

            return [$row];
        }

        [$size, $dexParts] = $this->fitSingle($dex, self::FONT_NUMERALS, $dexSize[0], $dexSize[1], $width);

        return [$this->row('dex', [[$dexParts[0], self::FONT_NUMERALS, 'secondary', 'dex']], $size, self::FONT_NUMERALS), $row];
    }

    /**
     * @param  list<array{0: string, 1: string, 2: string, 3: string}>  $parts  text, font, tone, box key
     * @return array{key: string, size: int, gap: int, ascent: int, descent: int, parts: list<array{text: string, font: string, tone: string, box: string, size: int|null, after: int}>}
     */
    private function row(string $key, array $parts, int $size, string $font): array
    {
        [$ascent, $descent] = $this->metrics($font, $size);

        return [
            'key' => $key,
            'size' => $size,
            // The space above a row, from its own size: a name gets more air than a data line.
            'gap' => (int) round($size * ($key === 'title' ? 0.3 : 0.42)),
            'ascent' => $ascent,
            'descent' => $descent,
            'parts' => array_map(fn (array $part): array => ['text' => $part[0], 'font' => $part[1], 'tone' => $part[2], 'box' => $part[3], 'size' => null, 'after' => 0], $parts),
        ];
    }

    /**
     * One line: shrinks to $minimum, then ends in "…".
     *
     * @return array{0: int, 1: list<string>}
     */
    private function fitSingle(string $text, string $font, int $display, int $minimum, int $width): array
    {
        $path = resource_path('fonts/'.$font);

        for ($size = $display; $size > $minimum; $size -= 2) {
            if ($this->width($path, $size, $text) <= $width) {
                return [$size, [$text]];
            }
        }

        return [$minimum, [$this->fitOne($text, $font, $minimum, $minimum, $width)]];
    }

    /**
     * Rule 2: one line while it fits at a size down to $minimum; else two lines broken at a word boundary (the most even break) at the
     * largest size where both fit; only when no break fits even at the minimum does the second line end in "…".
     *
     * @return array{0: int, 1: list<string>}
     */
    private function fitLines(string $text, string $font, int $display, int $minimum, int $width): array
    {
        $path = resource_path('fonts/'.$font);

        for ($size = $display; $size >= $minimum; $size -= 2) {
            if ($this->width($path, $size, $text) <= $width) {
                return [$size, [$text]];
            }
        }

        $words = preg_split('/ /u', $text, -1, PREG_SPLIT_NO_EMPTY) ?: [$text];

        if (count($words) > 1) {
            for ($size = $display; $size >= $minimum; $size -= 2) {
                $best = null;
                $bestWidth = PHP_INT_MAX;

                for ($split = 1; $split < count($words); $split++) {
                    $first = implode(' ', array_slice($words, 0, $split));
                    $second = implode(' ', array_slice($words, $split));
                    $widest = max($this->width($path, $size, $first), $this->width($path, $size, $second));

                    if ($widest <= $width && $widest < $bestWidth) {
                        $best = [$first, $second];
                        $bestWidth = $widest;
                    }
                }

                if ($best !== null) {
                    return [$size, $best];
                }
            }
        }

        // The last resort: as many whole words as fit on the first line, the rest ends in "…".
        $first = '';

        foreach ($words as $index => $word) {
            $candidate = $first === '' ? $word : $first.' '.$word;

            if ($this->width($path, $minimum, $candidate) > $width) {
                break;
            }

            $first = $candidate;
            unset($words[$index]);
        }

        if ($first === '') {
            $first = $this->fitOne((string) array_shift($words), $font, $minimum, $minimum, $width);

            return [$minimum, [$first]];
        }

        $rest = implode(' ', $words);

        return [$minimum, $rest === '' ? [$first] : [$first, $this->fitOne($rest, $font, $minimum, $minimum, $width)]];
    }

    /**
     * The text at $size, ending in "…" when it is wider than $width (at a word boundary where one is near).
     */
    private function fitOne(string $text, string $font, int $size, int $minimum, int $width): string
    {
        $path = resource_path('fonts/'.$font);
        unset($minimum);

        if ($this->width($path, $size, $text) <= $width) {
            return $text;
        }

        while (mb_strlen($text) > 1 && $this->width($path, $size, rtrim($text).'…') > $width) {
            $text = mb_substr($text, 0, -1);
        }

        return rtrim($text).'…';
    }

    /**
     * Ascent and descent of a font at a size, from its tallest and deepest letters (accented capitals, descenders).
     *
     * @return array{0: int, 1: int}
     */
    private function metrics(string $font, int $size): array
    {
        $key = $font.'@'.$size;

        if (! isset($this->metrics[$key])) {
            $box = imagettfbbox($size, 0, resource_path('fonts/'.$font), 'ÅÉÖÜÇgjpqy|');
            // The descent gets a margin: GD's anti-aliasing reaches below the box imagettfbbox() reports (the "y" of a large name touched
            // the story's bottom 250 px by a pixel). The tops sit inside it already: the sample's accented capitals are taller than a line.
            $margin = 1 + intdiv($size, 48);
            $this->metrics[$key] = $box === false ? [$size, (int) ceil($size * 0.3)] : [max(1, -min((int) $box[5], (int) $box[7])), max(0, (int) $box[1], (int) $box[3]) + $margin];
        }

        return $this->metrics[$key];
    }

    /**
     * The photo window (cropWindow) scaled into its box.
     */
    private function photo(GdImage $image, string $bytes, int $x, int $y, int $width, int $height, float $zoom, float $centreX, float $centreY): void
    {
        $source = @imagecreatefromstring($bytes);

        if (! $source instanceof GdImage) {
            throw new RuntimeException('GD could not read the share card photo.');
        }

        [$sourceX, $sourceY, $sourceWidth, $sourceHeight] = self::cropWindow(imagesx($source), imagesy($source), $width, $height, $zoom, $centreX, $centreY);
        imagecopyresampled($image, $source, $x, $y, $sourceX, $sourceY, $width, $height, $sourceWidth, $sourceHeight);
    }

    /**
     * The frame's photo corners in the ground's colour, smoothed at the edge of the arc.
     */
    private function roundCorners(GdImage $image, int $x, int $y, int $width, int $height, int $radius, string $token, string $theme): void
    {
        [$red, $green, $blue] = DesignTokens::rgba($token, $theme);

        foreach ([[$x, $y, 1, 1], [$x + $width - 1, $y, -1, 1], [$x, $y + $height - 1, 1, -1], [$x + $width - 1, $y + $height - 1, -1, -1]] as [$cornerX, $cornerY, $dx, $dy]) {
            for ($i = 0; $i < $radius; $i++) {
                for ($j = 0; $j < $radius; $j++) {
                    $distance = sqrt((($radius - $i - 0.5) ** 2) + (($radius - $j - 0.5) ** 2));
                    $outside = max(0.0, min(1.0, $distance - $radius + 0.5));

                    if ($outside > 0) {
                        $alpha = max(0, min(127, 127 - (int) round($outside * 127)));
                        imagesetpixel($image, $cornerX + ($i * $dx), $cornerY + ($j * $dy), (int) imagecolorallocatealpha($image, $red, $green, $blue, $alpha));
                    }
                }
            }
        }
    }

    /**
     * A vertical scrim from one colour token to another (rgba, interpolated), across the card's width.
     */
    private function scrim(GdImage $image, int $width, int $from, int $to, string $startToken, string $endToken): void
    {
        $start = DesignTokens::rgba($startToken);
        $end = DesignTokens::rgba($endToken);

        for ($y = $from; $y < $to; $y++) {
            $t = ($y - $from) / max(1, $to - $from);
            $channel = fn (int $index): int => (int) round($start[$index] + (($end[$index] - $start[$index]) * $t));
            $opacity = $start[3] + (($end[3] - $start[3]) * $t);
            $color = (int) imagecolorallocatealpha($image, max(0, min(255, $channel(0))), max(0, min(255, $channel(1))), max(0, min(255, $channel(2))), max(0, min(127, 127 - (int) round($opacity * 127))));
            imageline($image, 0, $y, $width, $y, $color);
        }
    }

    /**
     * M5.9c ★ the Build Score as a tachometer (the app's BuildScoreGauge): a 240° arc open at the bottom, the reached part in the accent
     * fill (the card's only red, well under 5 % of it), ticks every tenth, the needle, the total in Archivo Condensed and the stage under
     * it. Always on the photo, on its own scrim disc (rule 6: the square band's too); colours from the carbon tokens.
     *
     * @param  array{total: int, max: int, stage: string, label: string}  $score
     */
    private function gauge(GdImage $image, int $cx, int $cy, int $radius, array $score): void
    {
        $theme = 'carbon';
        $start = 150.0;
        $sweep = 240.0;
        $share = $score['max'] > 0 ? max(0.0, min(1.0, $score['total'] / $score['max'])) : 0.0;
        $thickness = max(6, (int) round($radius * 0.09));

        imagefilledellipse($image, $cx, $cy, ($radius + self::DISC) * 2, ($radius + self::DISC) * 2, $this->token($image, 'overlay-scrim', $theme));

        $this->arc($image, $cx, $cy, $radius, $start, $start + $sweep, $thickness, $this->token($image, 'border-strong', $theme));

        if ($share > 0) {
            $this->arc($image, $cx, $cy, $radius, $start, $start + ($sweep * $share), $thickness, $this->token($image, 'accent-fill', $theme));
        }

        $tick = $this->token($image, 'text-tertiary', $theme);
        imagesetthickness($image, 3);

        for ($step = 0; $step <= 10; $step++) {
            $angle = deg2rad($start + ($sweep * $step / 10));
            $outer = $radius - $thickness;
            $inner = $outer - ($step % 2 === 0 ? (int) round($radius * 0.13) : (int) round($radius * 0.07));
            imageline($image, (int) round($cx + cos($angle) * $inner), (int) round($cy + sin($angle) * $inner), (int) round($cx + cos($angle) * $outer), (int) round($cy + sin($angle) * $outer), $tick);
        }

        $primary = $this->token($image, 'on-photo-primary', $theme);
        $needle = deg2rad($start + ($sweep * $share));
        $length = $radius - ($thickness * 2) - 8;
        imagesetthickness($image, max(3, (int) round($radius * 0.03)));
        imageline($image, $cx, $cy, (int) round($cx + cos($needle) * $length), (int) round($cy + sin($needle) * $length), $primary);
        imagesetthickness($image, 1);
        imagefilledellipse($image, $cx, $cy, max(10, (int) round($radius * 0.14)), max(10, (int) round($radius * 0.14)), $primary);

        // In the opening at the bottom, clear of the needle: the total, then the stage and the name under it (gaugeCaptions).
        $secondary = $this->token($image, 'on-photo-secondary', $theme);
        [$numberSize] = self::gaugeSizes($radius);
        $this->centred($image, self::FONT_NUMERALS, (string) $score['total'], $numberSize, $cx, $cy + (int) round($radius * 0.52), $primary);

        foreach ($this->gaugeCaptions($cy, $radius, [$score['stage'], $score['label']]) as [$text, $size, $baseline]) {
            $this->centred($image, self::FONT_TEXT, $text, $size, $cx, $baseline, $secondary);
        }
    }

    /**
     * A thick arc from $from to $to degrees (GD's: 0 at three o'clock, clockwise), as a row of filled dots in one opaque colour.
     */
    private function arc(GdImage $image, int $cx, int $cy, int $radius, float $from, float $to, int $thickness, int $color): void
    {
        for ($angle = $from; $angle <= $to; $angle += 0.5) {
            $rad = deg2rad($angle);
            imagefilledellipse($image, (int) round($cx + cos($rad) * $radius), (int) round($cy + sin($rad) * $radius), $thickness, $thickness, $color);
        }
    }

    private function centred(GdImage $image, string $font, string $text, int $size, int $cx, int $baseline, int $color): void
    {
        if ($text === '') {
            return;
        }

        $path = resource_path('fonts/'.$font);
        imagettftext($image, $size, 0, $cx - intdiv($this->width($path, $size, $text), 2), $baseline, $color, $path, str_replace('&', '&#38;', $text));
    }

    private function token(GdImage $image, string $token, string $theme = 'carbon'): int
    {
        [$red, $green, $blue, $alpha] = DesignTokens::rgba($token, $theme);

        return (int) imagecolorallocatealpha($image, $red, $green, $blue, max(0, min(127, 127 - (int) round($alpha * 127))));
    }

    /**
     * The delivered wordmark, scaled to $targetWidth with its own proportions.
     */
    private function logo(GdImage $image, string $file, int $x, int $y, int $targetWidth): void
    {
        $logo = @imagecreatefrompng(public_path($file));

        if (! $logo instanceof GdImage) {
            throw new RuntimeException('GD could not read the wordmark.');
        }

        imagealphablending($logo, true);
        $targetHeight = (int) round(imagesy($logo) * $targetWidth / imagesx($logo));
        imagecopyresampled($image, $logo, $x, $y, 0, 0, $targetWidth, $targetHeight, imagesx($logo), imagesy($logo));
    }

    /**
     * White panel: the code at full size (its quiet zone is white already), the black wordmark under it on the same white.
     */
    private function drawQrPanel(GdImage $image, string $png, int $x, int $y, int $size, int $caption): void
    {
        $code = @imagecreatefromstring($png);

        if (! $code instanceof GdImage) {
            throw new RuntimeException('GD could not read the QR code.');
        }

        $white = (int) imagecolorallocate($image, 255, 255, 255);
        imagefilledrectangle($image, $x, $y, $x + $size - 1, $y + $size + $caption - 1, $white);
        imagecopyresampled($image, $code, $x, $y, 0, 0, $size, $size, imagesx($code), imagesy($code));
        $logoWidth = (int) round($size * 0.6);
        $logoHeight = (int) round($logoWidth * self::LOGO_RATIO);
        $this->logo($image, 'brand/logo-wide-black-640.png', $x + intdiv($size - $logoWidth, 2), $y + $size + max(0, intdiv($caption - $logoHeight, 2) - 4), $logoWidth);
    }

    private function archivoCovers(string $text): bool
    {
        foreach (mb_str_split($text) as $character) {
            $codePoint = mb_ord($character);
            $covered = false;

            foreach (OgImageCanvas::ARCHIVO_RANGES as [$from, $to]) {
                if ($codePoint >= $from && $codePoint <= $to) {
                    $covered = true;

                    break;
                }
            }

            if (! $covered) {
                return false;
            }
        }

        return true;
    }

    private function width(string $font, int $size, string $text): int
    {
        $key = $font.'@'.$size.'@'.$text;

        if (! isset($this->widths[$key])) {
            if (count($this->widths) > 4096) {
                $this->widths = [];
            }

            $box = imagettfbbox($size, 0, $font, str_replace('&', '&#38;', $text));
            $this->widths[$key] = $box === false ? 0 : abs((int) $box[2] - (int) $box[0]);
        }

        return $this->widths[$key];
    }
}
