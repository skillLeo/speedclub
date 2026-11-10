<?php

use App\Services\Qr\QrRenderer;
use chillerlan\QRCode\Common\EccLevel;
use chillerlan\QRCode\Data\AlphaNum;
use chillerlan\QRCode\QRCode as Library;
use chillerlan\QRCode\QROptions;

/**
 * @return array<string, true> "x,y" of every dark module the runs of the SVG cover
 */
function compactSvgDarkModules(string $svg): array
{
    preg_match('~<path class="qr-dark" fill="#000" d="([^"]+)"/>~', $svg, $path);
    preg_match_all('~M(\d+) (\d+)h(\d+)v1h-\3z~', $path[1] ?? '', $runs, PREG_SET_ORDER);
    $modules = [];

    foreach ($runs as [, $x, $y, $length]) {
        for ($i = 0; $i < (int) $length; $i++) {
            $modules[((int) $x + $i).','.$y] = true;
        }
    }

    return $modules;
}

it('draws exactly the dark modules of the matrix, on one white square of the full size', function (string $payload) {
    $svg = app(QrRenderer::class)->svg($payload);
    $matrix = (new Library(new QROptions(['eccLevel' => EccLevel::Q, 'addQuietzone' => true, 'quietzoneSize' => QrRenderer::QUIET_ZONE])))
        ->addSegment(new AlphaNum($payload))->getQRMatrix();
    $size = $matrix->getSize();
    $expected = [];

    for ($y = 0; $y < $size; $y++) {
        for ($x = 0; $x < $size; $x++) {
            if ($matrix->check($x, $y)) {
                $expected[$x.','.$y] = true;
            }
        }
    }

    $drawn = compactSvgDarkModules($svg);
    ksort($expected);
    ksort($drawn);

    expect($drawn)->toBe($expected)
        ->and($svg)->toContain('viewBox="0 0 '.$size.' '.$size.'"')
        ->toContain('<path class="qr-light" fill="#fff" d="M0 0h'.$size.'v'.$size.'h-'.$size.'z"/>')
        // A run never continues past the end of its row.
        ->and(collect(array_keys($drawn))->every(fn (string $key): bool => (int) explode(',', $key)[0] < $size))->toBeTrue();
})->with([
    'sticker address' => ['HTTPS://SPEEDCLUB.APP/C/8TR0Q3MC'],
    'build page' => ['HTTP://LOCALHOST:8080/V/NISSAN-SKYLINE-GT-R-R34-5TF974VJ'],
]);

it('stays a fraction of the module-by-module markup', function () {
    expect(strlen(app(QrRenderer::class)->svg('HTTP://LOCALHOST:8080/V/NISSAN-SKYLINE-GT-R-R34-5TF974VJ')))->toBeLessThan(8000);
});
