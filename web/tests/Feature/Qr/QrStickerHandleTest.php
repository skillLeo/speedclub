<?php

use App\Models\User;
use App\Services\Qr\QrCodes;
use App\Services\Qr\QrSticker;
use FontLib\Font;

require_once dirname(__DIR__).'/Garage/GarageTestHelpers.php';

/**
 * BH-27: the printed @username is always whole. It shrinks to fit the text area of the A6 sheet, on one page and at the same line height.
 */
const STICKER_TEXT_WIDTH_PT = 252.3;

/**
 * The width of a text in Barlow Semi Condensed Bold, read from the font, not from what the code under test measures.
 */
function stickerHandleWidth(string $text, float $size): float
{
    $font = Font::load(resource_path('fonts/BarlowSemiCondensed-Bold.ttf'));
    $font->parse();
    $map = $font->getUnicodeCharMap();
    $advances = $font->getData('hmtx');
    $units = 0;

    foreach (mb_str_split($text) as $character) {
        $units += $advances[$map[mb_ord($character)]][0];
    }

    return $units * $size / $font->getData('head', 'unitsPerEm');
}

/**
 * What the PDF's page really says: the font sizes in its content streams.
 *
 * @return list<float>
 */
function stickerFontSizes(string $pdf): array
{
    preg_match_all('~stream\r?\n(.*?)\r?\nendstream~s', $pdf, $streams);
    $sizes = [];

    foreach ($streams[1] as $stream) {
        $content = @gzuncompress($stream);

        if ($content !== false && preg_match_all('~/F\d+ ([\d.]+) Tf~', $content, $matches) > 0) {
            $sizes = [...$sizes, ...array_map(floatval(...), $matches[1])];
        }
    }

    return $sizes;
}

function stickerFor(string $username): array
{
    $owner = User::factory()->create(['username' => $username]);
    $vehicle = publishedVehicle($owner);

    return [app(QrCodes::class)->ensureActive($vehicle), $owner];
}

it('shrinks the widest name until it fits, on one page, in both languages', function (string $locale) {
    app()->setLocale($locale);
    [$qr] = stickerFor(str_repeat('m', 24));

    $data = app(QrSticker::class)->viewData($qr);
    $pdf = app(QrSticker::class)->pdf($qr);

    expect($data['username_size'])->toBe(13)
        ->and(stickerHandleWidth('@'.str_repeat('m', 24), $data['username_size']))->toBeLessThanOrEqual(STICKER_TEXT_WIDTH_PT)
        ->and(preg_match_all('~/Type\s*/Page\b(?!s)~', $pdf))->toBe(1)
        ->and(stickerFontSizes($pdf))->toContain(13.0)
        ->and(stickerFontSizes($pdf))->not->toContain(22.0);
})->with(['de', 'en']);

it('fits a realistic long name, by as little as it needs', function (string $username, int $size) {
    [$qr] = stickerFor($username);

    $data = app(QrSticker::class)->viewData($qr);

    expect($data['username_size'])->toBe($size)
        ->and(stickerHandleWidth('@'.$username, $size))->toBeLessThanOrEqual(STICKER_TEXT_WIDTH_PT);
})->with([
    'wide letters' => ['wwwwwwwwwwwwwwwwwwwwwwww', 14],
    'cut off before' => ['bmw_m_power_werkstatt_mw', 18],
    'past the margin before' => ['wolfgang.mmw.werkstatt_w', 20],
]);

it('leaves a normal name at 22 pt', function (string $username) {
    [$qr] = stickerFor($username);

    expect(app(QrSticker::class)->viewData($qr)['username_size'])->toBe(22)
        ->and(stickerFontSizes(app(QrSticker::class)->pdf($qr)))->toContain(22.0);
})->with(['lukas.sc', 'max', 'finn.jdm_1998']);

it('keeps the line height of 26 pt, so the sheet does not move', function () {
    [$qr] = stickerFor(str_repeat('m', 24));

    $html = view('pdf.qr-sticker', app(QrSticker::class)->viewData($qr))->render();

    expect($html)->toContain('line-height: 26pt')
        ->and($html)->toContain('class="username" style="font-size: 13pt"');
});

it('needs no size without a name on the sheet', function () {
    $owner = User::factory()->create(['username' => 'lukas.sc', 'show_owner_on_qr' => false]);
    $qr = app(QrCodes::class)->ensureActive(publishedVehicle($owner));

    $data = app(QrSticker::class)->viewData($qr);

    expect($data['username'])->toBeNull()
        ->and($data['username_size'])->toBe(22)
        ->and(view('pdf.qr-sticker', $data)->render())->not->toContain('class="username"');
});
