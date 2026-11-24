<?php

use App\Enums\StickerColourway;
use App\Enums\StickerMaterial;
use App\Enums\StickerSize;
use App\Enums\StickerTemplate;
use App\Models\QrCode;
use App\Services\Qr\QrCodes;
use App\Services\Stickers\StickerCatalogue;
use App\Services\Stickers\StickerContent;
use App\Services\Stickers\StickerFonts;
use App\Services\Stickers\StickerInks;
use App\Services\Stickers\StickerLayout;
use App\Services\Stickers\StickerOptions;
use App\Services\Stickers\StickerRaster;
use App\Services\Stickers\StickerScanner;
use App\Services\Stickers\StickerSvg;
use App\Support\Codes;

require_once __DIR__.'/StickerTestHelpers.php';

/**
 * The sticker QR-decode suite (10 §12 M5.4 and §15 exit evidence; m5.4-contract §4, §9). Every template × every ink/material/mirror
 * variant × S/M/L × every combination of the template's text options, with the code on, is laid out by the layout the print files use,
 * rasterised by the Scan-Test as a camera sees it on the car, and the whole sticker (not a crop) is decoded back to the sticker
 * address `/C/{code}` with error correction H. A mirrored print is also decoded from the print raster itself, laid on the glass and
 * turned back. The rules of 10 §2.3 hold on every artwork: printed code ≥ 25 mm, quiet zone 4 modules, contrast ≥ 7:1.
 *
 * The lines are the longest a member can enter: a 24-character custom line of wide letters, a long car name, a 24-character username.
 */
const STK_HOST = 'https://joinspeedclub.com';

const STK_LONG_LINE = 'WWWWWWWWWWWWWWWWWWWWWWWW';

beforeEach(function () {
    config(['app.url' => STK_HOST]);
    $this->code = new QrCode(['code' => Codes::generate()]);
    $this->payload = app(QrCodes::class)->payload($this->code);
    $this->content = fn (array $lines) => new StickerContent(
        payload: $this->payload,
        username: 'mmmmmmmmmmmmmmmmmmmmmmmm',
        carName: 'Mercedes-Benz SLS AMG Black Series C197',
        customLine: STK_LONG_LINE,
    );
});

it('decodes every template, ink, size and text combination back to the sticker address', function (StickerTemplate $template, StickerColourway $colourway, StickerMaterial $material, bool $mirrored, StickerSize $size, array $lines) {
    $options = StickerOptions::fromArray($template, [
        'size' => $size->value, 'colourway' => $colourway->value, 'material' => $material->value, 'mirrored' => $mirrored, 'qr' => true,
        'username' => $lines['username'], 'car_name' => $lines['car_name'], 'custom_line' => $lines['custom_line'] ? STK_LONG_LINE : null,
    ]);
    $artwork = app(StickerLayout::class)->build($options, ($this->content)($lines));
    $colours = StickerInks::qrColours($colourway, $material);

    expect($this->payload)->toBe('HTTPS://JOINSPEEDCLUB.COM/C/'.$this->code->code)
        ->and($artwork->qr())->not->toBeNull()
        ->and($artwork->qrSymbolMm())->toBeGreaterThanOrEqual(25.0)
        ->and(StickerInks::contrast($colours['dark'], $colours['light']))->toBeGreaterThanOrEqual(7.0);

    // As a camera sees it on the car: the whole sticker on its surface.
    $result = app(StickerScanner::class)->test($artwork, $this->payload);
    expect($result['decoded'])->toBe($this->payload)
        ->and($result['passed'])->toBeTrue();

    if ($mirrored) {
        // The print itself is mirrored and cannot be read from the front; stuck inside the glass and seen from outside, it reads right.
        $module = $artwork->qr()['size'] / ($artwork->qr()['modules'] + 8);
        $print = app(StickerRaster::class)->render($artwork, 4 / $module, 'print');
        $seen = stkOnSurface($print, StickerInks::surface($colourway));
        imageflip($seen, IMG_FLIP_HORIZONTAL);

        expect(stkDecode($seen))->toBe($this->payload);
    }
})->with(stkDecodeMatrix());

it('draws the same code into the print SVG the PDF is made from', function (StickerTemplate $template, StickerColourway $colourway) {
    $options = StickerOptions::fromArray($template, ['size' => 'm', 'colourway' => $colourway->value, 'qr' => true, 'username' => true, 'car_name' => true, 'custom_line' => 'Built not bought']);
    $artwork = app(StickerLayout::class)->build($options, ($this->content)([]));
    $svg = app(StickerSvg::class)->print($artwork, 'test');

    expect(stkDecode(stkSvgQrImage($svg, $colourway)))->toBe($this->payload)
        ->and($svg)->toContain('<g id="CutContour">')
        ->and($svg)->toContain('width="'.rtrim(rtrim(number_format($artwork->width, 3, '.', ''), '0'), '.').'mm"')
        ->and($svg)->not->toContain('<text');
})->with(StickerTemplate::cases())->with([StickerColourway::White, StickerColourway::Black, StickerColourway::WhiteRed]);

it('keeps the code at least 25 mm and decodable with a long address in byte mode', function (StickerTemplate $template) {
    config(['app.url' => 'https://staging.joinspeedclub.com/club']);
    $payload = app(QrCodes::class)->payload($this->code);
    $content = new StickerContent($payload, 'lukas.sc', 'Nissan Skyline GT-R R34', 'Built not bought');
    $artwork = app(StickerLayout::class)->build(StickerOptions::fromArray($template, ['size' => 's', 'qr' => true, 'username' => true]), $content);

    expect($artwork->qrSymbolMm())->toBeGreaterThanOrEqual(25.0)
        ->and(app(StickerScanner::class)->test($artwork, $payload)['passed'])->toBeTrue();
})->with(StickerTemplate::cases());

it('prints no code at all with QR off, and nothing reads as one', function (StickerTemplate $template, StickerColourway $colourway) {
    $options = StickerOptions::fromArray($template, ['size' => 's', 'colourway' => $colourway->value, 'qr' => false, 'username' => true, 'car_name' => true, 'custom_line' => 'Built not bought']);
    $artwork = app(StickerLayout::class)->build($options, ($this->content)([]));

    expect($artwork->qr())->toBeNull()
        ->and(app(StickerSvg::class)->print($artwork, 'test'))->not->toContain('id="qr"')
        ->and(stkDecode(app(StickerRaster::class)->render($artwork, 8, 'seen', 16)))->toBeNull();
})->with(StickerTemplate::cases())->with([StickerColourway::White, StickerColourway::Black]);

it('never lets the red accent or anything else into the code block', function (StickerTemplate $template) {
    $options = StickerOptions::fromArray($template, ['size' => 's', 'colourway' => 'white_red', 'qr' => true, 'username' => true, 'car_name' => true, 'custom_line' => STK_LONG_LINE]);
    $artwork = app(StickerLayout::class)->build($options, ($this->content)([]));
    $qr = $artwork->qr();
    $reds = array_filter($artwork->elements, fn (array $e): bool => ($e['ink'] ?? null) === StickerInks::RED);

    expect($reds)->not->toBeEmpty();

    foreach ($artwork->elements as $element) {
        if ($element['kind'] === 'qr') {
            continue;
        }

        $top = $element['kind'] === 'text' ? $element['baseline'] - $element['size'] : $element['y'];
        $bottom = $element['kind'] === 'text' ? $element['baseline'] : $element['y'] + $element['h'];
        $right = $element['kind'] === 'text' ? $element['x'] + StickerFonts::width($element['font'], $element['text']) * $element['size'] : $element['x'] + $element['w'];
        $overlaps = $element['x'] < $qr['x'] + $qr['size'] && $right > $qr['x'] && $top < $qr['y'] + $qr['size'] && $bottom > $qr['y'];

        expect($overlaps)->toBeFalse("{$element['kind']} overlaps the code block");
    }

    // Everything inside the die line; on the round badge every corner of every box inside the circle.
    foreach ($artwork->elements as $element) {
        $width = match ($element['kind']) {
            'text' => StickerFonts::width($element['font'], $element['text']) * $element['size'],
            'qr' => $element['size'],
            default => $element['w'],
        };
        $top = $element['kind'] === 'text' ? $element['baseline'] - StickerFonts::capHeight($element['font']) * $element['size'] : $element['y'];
        $bottom = match ($element['kind']) {
            'text' => $element['baseline'],
            'qr' => $element['y'] + $element['size'],
            default => $element['y'] + $element['h'],
        };

        expect($element['x'])->toBeGreaterThanOrEqual(0.0)
            ->and($element['x'] + $width)->toBeLessThanOrEqual($artwork->width)
            ->and($top)->toBeGreaterThanOrEqual(0.0)
            ->and($bottom)->toBeLessThanOrEqual($artwork->height);

        if ($artwork->shape === 'circle') {
            $r = $artwork->width / 2;

            foreach ([[$element['x'], $top], [$element['x'] + $width, $top], [$element['x'], $bottom], [$element['x'] + $width, $bottom]] as [$cx, $cy]) {
                expect(hypot($cx - $r, $cy - $r))->toBeLessThanOrEqual($r - 1.0, "{$element['kind']} leaves the round badge");
            }
        }
    }
})->with(StickerTemplate::cases());

it('tries the configured scale first, then one coarser and one finer (ADR-534)', function () {
    expect(StickerScanner::scales())->toBe([4, 3, 5]);

    config(['speedclub.stickers.decode_px_per_module' => 2]);
    expect(StickerScanner::scales())->toBe([2, 3]);
});

it('passes a valid code the reader misjudges at the configured scale, with the exact payload (ADR-534: V3VX6HGX on the plate template)', function (StickerColourway $colourway, StickerMaterial $material, bool $mirrored) {
    // ZXing, the reader of the phones, reads this code at every scale; chillerlan's detector misjudges its finder patterns at 4 px.
    $payload = app(QrCodes::class)->payload(new QrCode(['code' => 'V3VX6HGX']));
    $options = StickerOptions::fromArray(StickerTemplate::Plate, [
        'size' => StickerSize::cases()[0]->value, 'colourway' => $colourway->value, 'material' => $material->value, 'mirrored' => $mirrored, 'qr' => true,
        'username' => true, 'car_name' => false, 'custom_line' => null,
    ]);
    $artwork = app(StickerLayout::class)->build($options, new StickerContent(payload: $payload, username: 'mmmmmmmmmmmm', carName: 'BMW M3', customLine: null));
    $qr = $artwork->qr();
    $moduleMm = (float) $qr['size'] / ((int) $qr['modules'] + 2 * StickerCatalogue::QUIET_ZONE_MODULES);

    // The configured scale alone fails it: the reason the scanner tries the neighbouring scales ...
    expect(app(StickerScanner::class)->decode(app(StickerRaster::class)->render($artwork, 4 / $moduleMm, 'seen', 8), $payload)['passed'])->toBeFalse()
        // ... and the Scan-Test passes it, reading back exactly the sticker's address.
        ->and(app(StickerScanner::class)->test($artwork, $payload))->toBe(['passed' => true, 'decoded' => $payload]);
})->with(stkInkVariants());
