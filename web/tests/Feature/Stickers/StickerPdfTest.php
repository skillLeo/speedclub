<?php

use App\Enums\StickerSize;
use App\Enums\StickerTemplate;
use App\Models\StickerDesign;
use App\Services\Qr\QrCodes;
use App\Services\Stickers\StickerCatalogue;
use App\Services\Stickers\StickerFiles;

require_once __DIR__.'/StickerTestHelpers.php';

/**
 * The print-ready PDF (m5.4-contract §6.2): /TrimBox at the sticker's exact size in mm, /BleedBox 3 mm around it, /MediaBox with the
 * slug, crop marks as strokes, the die line, fonts embedded, the design id in the slug; page 2 the proof. Where poppler is installed
 * (local machines; never needed on the host) the PDF itself is rasterised at 300 dpi and its code decoded, and the slug text read.
 */
const STK_PT = 72 / 25.4;

/**
 * @return array{0: StickerDesign, 1: string}
 */
function stkPdf(StickerTemplate $template, array $options = []): array
{
    [$vehicle, $qr] = stkCar();
    $design = StickerDesign::factory()->validated($qr->id)->create([
        'vehicle_id' => $vehicle->id,
        'template' => $template,
        'options' => ['size' => 's', 'colourway' => 'black', 'material' => 'transparent', 'qr' => true, 'username' => true, 'car_name' => true, 'custom_line' => 'Built not bought', 'mirrored' => false, ...$options],
    ]);

    return [$design, app(StickerFiles::class)->printPdf($design, $vehicle)];
}

/**
 * @return list<float>
 */
function stkBox(string $pdf, string $box): array
{
    preg_match('/\/'.$box.' \[([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+)\]/', $pdf, $match);
    expect($match)->not->toBeEmpty("no /$box");

    return array_map('floatval', array_slice($match, 1));
}

/**
 * Every content stream, inflated.
 */
function stkStreams(string $pdf): string
{
    preg_match_all('/stream\r?\n(.*?)\r?\nendstream/s', $pdf, $streams);
    $out = '';

    foreach ($streams[1] as $stream) {
        $inflated = @gzuncompress($stream);
        $out .= ($inflated === false ? $stream : $inflated)."\n";
    }

    return $out;
}

it('sets the trim to the exact size in mm, 3 mm of bleed and a slug around it', function (StickerTemplate $template, StickerSize $size) {
    [, $pdf] = stkPdf($template, ['size' => $size->value]);
    $mm = StickerCatalogue::size($template, $size);
    $trim = stkBox($pdf, 'TrimBox');
    $bleed = stkBox($pdf, 'BleedBox');
    $media = stkBox($pdf, 'MediaBox');

    expect(round(($trim[2] - $trim[0]) / STK_PT, 2))->toBe(round($mm['width'], 2))
        ->and(round(($trim[3] - $trim[1]) / STK_PT, 2))->toBe(round($mm['height'], 2))
        ->and(round(($trim[0] - $bleed[0]) / STK_PT, 2))->toBe(3.0)
        ->and(round(($bleed[2] - $trim[2]) / STK_PT, 2))->toBe(3.0)
        ->and(round(($trim[1] - $bleed[1]) / STK_PT, 2))->toBe(3.0)
        ->and(round(($bleed[3] - $trim[3]) / STK_PT, 2))->toBe(3.0)
        ->and($media[0])->toBe(0.0)
        ->and($media[2])->toBeGreaterThan($bleed[2])
        ->and($media[3])->toBeGreaterThan($bleed[3])
        ->and(substr_count($pdf, '/TrimBox'))->toBe(2);
})->with(StickerTemplate::cases())->with([StickerSize::S, StickerSize::L]);

it('draws crop marks outside the bleed, embeds its fonts and names the design', function () {
    [$design, $pdf] = stkPdf(StickerTemplate::Classic);
    $content = stkStreams($pdf);
    $trim = stkBox($pdf, 'TrimBox');

    // Eight crop strokes: "x y m x y l S" pairs starting 1 mm outside the bleed, i.e. 4 mm from the trim.
    preg_match_all('/([\d.]+) ([\d.]+) m ([\d.]+) ([\d.]+) l S/', $content, $lines, PREG_SET_ORDER);
    $marks = array_filter($lines, function (array $l) use ($trim): bool {
        [$x1, $y1, $x2, $y2] = array_map('floatval', array_slice($l, 1));

        return ($y1 === $y2 && in_array(round($y1, 1), [round($trim[1], 1), round($trim[3], 1)], true) && (max($x1, $x2) < $trim[0] || min($x1, $x2) > $trim[2]))
            || ($x1 === $x2 && in_array(round($x1, 1), [round($trim[0], 1), round($trim[2], 1)], true) && (max($y1, $y2) < $trim[1] || min($y1, $y2) > $trim[3]));
    });

    expect(count($marks))->toBe(8)
        ->and(substr_count($pdf, '/FontFile2'))->toBeGreaterThanOrEqual(3)
        // The document title carries the design id (Cpdf writes info strings as UTF-16BE).
        ->and($pdf)->toContain(mb_convert_encoding('Speedclub Sticker '.$design->reference.' v1', 'UTF-16BE', 'UTF-8'))
        ->and($pdf)->toStartWith('%PDF-');

    // The cross-reference table still points at every object after the boxes were written in.
    preg_match('/startxref\n(\d+)/', $pdf, $start);
    expect(substr($pdf, (int) $start[1], 4))->toBe('xref');
    preg_match('/xref\n0 (\d+)\n/', $pdf, $xref, PREG_OFFSET_CAPTURE);
    $table = substr($pdf, $xref[0][1] + strlen($xref[0][0]), 20 * (int) $xref[1][0]);

    foreach (array_slice(str_split($table, 20), 1) as $index => $entry) {
        $offset = (int) substr($entry, 0, 10);
        expect(substr($pdf, $offset, strlen(($index + 1).' 0 obj')))->toBe(($index + 1).' 0 obj');
    }
});

it('prints the design id, the code and the production notes in the slug', function () {
    [$design, $pdf] = stkPdf(StickerTemplate::VerticalJdm, ['colourway' => 'white', 'mirrored' => true]);
    $file = tempnam(sys_get_temp_dir(), 'stk').'.pdf';
    file_put_contents($file, $pdf);
    exec('pdftotext -layout '.escapeshellarg($file).' -', $text);
    $text = implode("\n", $text);
    @unlink($file);

    expect($text)->toContain($design->reference)
        ->and($text)->toContain('Vertical JDM')
        ->and($text)->toContain('Weißer Druck')
        ->and($text)->toContain('gespiegelt')
        ->and($text)->toContain(app(QrCodes::class)->displayCode($design->qrCode->code))
        ->and($text)->toContain('Schneidekontur')
        ->and($text)->toContain('nicht drucken');
})->skip(fn () => trim((string) shell_exec('command -v pdftotext')) === '', 'pdftotext is not installed here');

it('reads the code back from the printed PDF itself at 300 dpi', function (StickerTemplate $template, string $colourway, bool $mirrored, int $page, string $material = 'transparent') {
    [$design, $pdf] = stkPdf($template, ['colourway' => $colourway, 'mirrored' => $mirrored, 'material' => $material]);
    $dir = sys_get_temp_dir().'/stk-'.bin2hex(random_bytes(4));
    mkdir($dir);
    file_put_contents("$dir/s.pdf", $pdf);
    exec('pdftoppm -r 300 -png -f '.$page.' -l '.$page.' '.escapeshellarg("$dir/s.pdf").' '.escapeshellarg("$dir/p"));
    $png = glob("$dir/p*.png")[0] ?? null;
    expect($png)->not->toBeNull();
    $image = imagecreatefrompng($png);

    // Page 1 is the print on white paper: a mirrored print is read turned back, as through the glass.
    if ($page === 1 && $mirrored) {
        imageflip($image, IMG_FLIP_HORIZONTAL);
    }

    array_map('unlink', glob("$dir/*") ?: []);
    rmdir($dir);

    expect(stkDecode($image))->toBe(app(QrCodes::class)->payload($design->qrCode));
})->with([
    'classic black, print' => [StickerTemplate::Classic, 'black', false, 1],
    'plate black mirrored, print' => [StickerTemplate::Plate, 'black', true, 1],
    'round white, proof' => [StickerTemplate::Round, 'white', false, 2],
    'vertical white+red, proof' => [StickerTemplate::VerticalJdm, 'white_red', false, 2],
    'banner white mirrored, proof' => [StickerTemplate::Banner, 'white', true, 2],
    'minimal black on white vinyl, proof' => [StickerTemplate::Minimal, 'black', false, 2, 'white_vinyl'],
])->skip(fn () => trim((string) shell_exec('command -v pdftoppm')) === '', 'pdftoppm is not installed here');
