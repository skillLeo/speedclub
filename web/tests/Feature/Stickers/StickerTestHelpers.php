<?php

use App\Enums\StickerColourway;
use App\Enums\StickerMaterial;
use App\Enums\StickerSize;
use App\Enums\StickerTemplate;
use App\Models\FeatureFlag;
use App\Models\QrCode;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\Qr\QrCodes;
use App\Services\Stickers\StickerCatalogue;
use App\Services\Stickers\StickerInks;
use chillerlan\QRCode\Common\GDLuminanceSource;
use chillerlan\QRCode\QRCode as Library;
use chillerlan\QRCode\QROptions;

require_once dirname(__DIR__).'/Garage/GarageTestHelpers.php';

/**
 * M5.4 sticker test helpers, prefixed stk… so they never collide with another file's functions.
 */

/**
 * A published car with an active code, owned by $owner (a new member when null).
 *
 * @return array{0: Vehicle, 1: QrCode}
 */
function stkCar(?User $owner = null, array $attributes = []): array
{
    $vehicle = publishedVehicle($owner ?? User::factory()->create(), $attributes);
    $qr = app(QrCodes::class)->ensureActive($vehicle);

    return [$vehicle->refresh(), $qr];
}

function stkStatsFlag(): void
{
    FeatureFlag::query()->updateOrCreate(['key' => 'sig.qr_stats'], ['enabled' => true]);
}

/**
 * The ink, material and mirror variants a design can have: white and white + red only on transparent vinyl, each plain and mirrored;
 * black on transparent (plain, mirrored) and on white vinyl.
 *
 * @return array<string, array{0: StickerColourway, 1: StickerMaterial, 2: bool}>
 */
function stkInkVariants(): array
{
    return [
        'white' => [StickerColourway::White, StickerMaterial::Transparent, false],
        'white mirrored' => [StickerColourway::White, StickerMaterial::Transparent, true],
        'white+red' => [StickerColourway::WhiteRed, StickerMaterial::Transparent, false],
        'white+red mirrored' => [StickerColourway::WhiteRed, StickerMaterial::Transparent, true],
        'black' => [StickerColourway::Black, StickerMaterial::Transparent, false],
        'black mirrored' => [StickerColourway::Black, StickerMaterial::Transparent, true],
        'black on white vinyl' => [StickerColourway::Black, StickerMaterial::WhiteVinyl, false],
    ];
}

/**
 * Every combination of the text options a template shows, all off to all on.
 *
 * @return list<array{username: bool, car_name: bool, custom_line: bool}>
 */
function stkTextCombinations(StickerTemplate $template): array
{
    $shown = StickerCatalogue::textOptions($template);
    $combinations = [];

    for ($mask = 0; $mask < 2 ** count($shown); $mask++) {
        $combination = ['username' => false, 'car_name' => false, 'custom_line' => false];

        foreach ($shown as $bit => $option) {
            $combination[$option] = ($mask & (1 << $bit)) !== 0;
        }

        $combinations[] = $combination;
    }

    return $combinations;
}

/**
 * The decode-suite dataset: template × ink variant × size × text combination, with QR on.
 *
 * @return Generator<string, array{0: StickerTemplate, 1: StickerColourway, 2: StickerMaterial, 3: bool, 4: StickerSize, 5: array{username: bool, car_name: bool, custom_line: bool}}>
 */
function stkDecodeMatrix(): Generator
{
    foreach (StickerTemplate::cases() as $template) {
        foreach (stkInkVariants() as $variant => [$colourway, $material, $mirrored]) {
            foreach (StickerSize::cases() as $size) {
                foreach (stkTextCombinations($template) as $lines) {
                    $on = implode('+', array_keys(array_filter($lines))) ?: 'no lines';

                    yield "{$template->value} · $variant · {$size->value} · $on" => [$template, $colourway, $material, $mirrored, $size, $lines];
                }
            }
        }
    }
}

/**
 * Decodes a GD image with the reader of the Scan-Test; null when nothing could be read.
 */
function stkDecode(GdImage $image): ?string
{
    try {
        $options = new QROptions;

        return (new Library($options))->readFromSource(new GDLuminanceSource($image, $options))->data;
    } catch (Throwable) {
        return null;
    }
}

/**
 * A transparent print raster laid on the surface the sticker is made for, as it is stuck on the car.
 *
 * @param  array{int, int, int}  $surface
 */
function stkOnSurface(GdImage $print, array $surface): GdImage
{
    $canvas = imagecreatetruecolor(imagesx($print) + 40, imagesy($print) + 40);
    imagefill($canvas, 0, 0, (int) imagecolorallocate($canvas, ...$surface));
    imagealphablending($canvas, true);
    imagecopy($canvas, $print, 20, 20, 0, 0, imagesx($print), imagesy($print));

    return $canvas;
}

/**
 * The QR runs of a print SVG back into pixels: the `qr` path of module runs, drawn as the ink it is (white ink = the light modules and
 * the quiet zone around dark gaps, black ink = the dark modules), at 6 px per module.
 */
function stkSvgQrImage(string $svg, StickerColourway $colourway): GdImage
{
    preg_match('/<path id="qr" transform="translate\(([\d.]+) ([\d.]+)\) scale\(([\d.]+)\)" d="([^"]+)"/', $svg, $match);
    expect($match)->not->toBeEmpty();
    preg_match_all('/M(\d+) (\d+)h(\d+)v1h-\d+z/', $match[4], $runs, PREG_SET_ORDER);
    $count = 0;

    foreach ($runs as $run) {
        $count = max($count, (int) $run[1] + (int) $run[3], (int) $run[2] + 1);
    }

    $px = 6;
    $white = $colourway->isWhiteInk();
    $image = imagecreatetruecolor($count * $px, $count * $px);
    $ink = (int) imagecolorallocate($image, ...($white ? [255, 255, 255] : [0, 0, 0]));
    imagefill($image, 0, 0, (int) imagecolorallocate($image, ...($white ? StickerInks::surface($colourway) : [255, 255, 255])));

    foreach ($runs as $run) {
        imagefilledrectangle($image, (int) $run[1] * $px, (int) $run[2] * $px, ((int) $run[1] + (int) $run[3]) * $px - 1, ((int) $run[2] + 1) * $px - 1, $ink);
    }

    // The surface around it, as on the car.
    $framed = imagecreatetruecolor(imagesx($image) + 12 * $px, imagesy($image) + 12 * $px);
    imagefill($framed, 0, 0, (int) imagecolorallocate($framed, ...($white ? StickerInks::surface($colourway) : [255, 255, 255])));
    imagecopy($framed, $image, 6 * $px, 6 * $px, 0, 0, imagesx($image), imagesy($image));

    return $framed;
}

/**
 * @return array<string, mixed>
 */
function stkDesignBody(int $base = 0, string $template = 'classic', array $options = [], int $revision = 0): array
{
    return ['base_version' => $base, 'base_revision' => $revision, 'template' => $template, 'options' => $options];
}
