<?php

use App\Services\Media\Pixelator;

/**
 * ADR-509 block rule (M5.9a): at least a third of the region's height (a plate is at most 3 block rows high), never below the photo-wide
 * floor of 1/60 of the long side (at least 8 px).
 */
it('sizes the block from the region and never below the photo-wide floor', function (int $width, int $height, int $regionHeight, int $block) {
    expect(Pixelator::blockSize($width, $height, $regionHeight))->toBe($block);
})->with([
    'plate on a 1600 photo: a third of 144' => [1600, 1200, 144, 48],
    'a close-up plate, 600 px high' => [4000, 3000, 600, 200],
    'a tiny region: the 1/60 floor' => [1600, 1200, 30, 27],
    'a small photo: the 8 px floor' => [320, 240, 12, 8],
    'odd height rounds up' => [1600, 1200, 145, 49],
]);

it('leaves at most 3 rows of flat blocks across a region of fine detail', function (int $regionHeight) {
    $image = imagecreatetruecolor(1600, 1200);
    mt_srand(509);

    for ($y = 0; $y < 1200; $y++) {
        for ($x = 400; $x < 1200; $x++) {
            imagesetpixel($image, $x, $y, (mt_rand(0, 255) << 16) | (mt_rand(0, 255) << 8) | mt_rand(0, 255));
        }
    }

    mt_srand();
    $top = 600;
    (new Pixelator)->pixelate($image, [['x' => 0.25, 'y' => $top / 1200, 'w' => 0.5, 'h' => $regionHeight / 1200]]);

    foreach ([420, 800, 1180] as $x) {
        $colors = [];

        for ($y = $top; $y < $top + $regionHeight; $y++) {
            $colors[] = imagecolorat($image, $x, $y);
        }

        // Flat blocks: the column holds at most 3 colours, each over a run of whole rows.
        expect(count(array_unique($colors)))->toBeLessThanOrEqual(Pixelator::MAX_ROWS)->toBeGreaterThanOrEqual(1);
    }

    // Outside the region nothing changed: the noise is still there.
    expect(imagecolorat($image, 800, $top - 1))->not->toBe(imagecolorat($image, 800, $top - 2));
})->with([144, 145, 300, 36]);

/**
 * Client round (angle): a turned region pixelates the rotated rectangle and nothing else. Every pixel sampled inside the rotated polygon
 * (inset 3 px) changed, every pixel outside it (by 3 px) is the same, including the parts of the unturned rectangle the turn left out.
 */
it('pixelates exactly the turned rectangle', function (float $angle) {
    $image = imagecreatetruecolor(800, 600);
    mt_srand(4509);

    for ($y = 0; $y < 600; $y++) {
        for ($x = 0; $x < 800; $x++) {
            imagesetpixel($image, $x, $y, (mt_rand(0, 255) << 16) | (mt_rand(0, 255) << 8) | mt_rand(0, 255));
        }
    }

    mt_srand();
    $before = imagecreatetruecolor(800, 600);
    imagecopy($before, $image, 0, 0, 0, 0, 800, 600);
    $region = ['x' => 0.3, 'y' => 0.45, 'w' => 0.4, 'h' => 0.1, 'angle' => $angle];

    (new Pixelator)->pixelate($image, [$region]);

    // The point turned back into the rectangle's own frame: inside when both offsets are within the half sides.
    $centreX = (0.3 + 0.2) * 800;
    $centreY = (0.45 + 0.05) * 600;
    $radians = deg2rad($angle);
    $inside = $changedInside = $outside = $changedOutside = $unturnedLeftOut = 0;

    for ($y = 150; $y < 450; $y += 2) {
        for ($x = 150; $x < 650; $x += 2) {
            $local = [($x - $centreX) * cos($radians) + ($y - $centreY) * sin($radians), -($x - $centreX) * sin($radians) + ($y - $centreY) * cos($radians)];
            $changed = imagecolorat($image, $x, $y) !== imagecolorat($before, $x, $y);

            if (abs($local[0]) <= 160 - 3 && abs($local[1]) <= 30 - 3) {
                $inside++;
                $changedInside += $changed ? 1 : 0;
            } elseif (abs($local[0]) >= 160 + 3 || abs($local[1]) >= 30 + 3) {
                $outside++;
                $changedOutside += $changed ? 1 : 0;
                $unturnedLeftOut += ($x >= 240 && $x < 560 && $y >= 270 && $y < 330) ? 1 : 0;
            }
        }
    }

    expect($inside)->toBeGreaterThan(1000)
        ->and($changedInside / $inside)->toBeGreaterThan(0.97)
        ->and($changedOutside)->toBe(0)
        ->and($unturnedLeftOut)->toBeGreaterThan(100);
})->with(['20° clockwise' => 20.0, '45° anticlockwise' => -45.0, 'a slight 3.5°' => 3.5]);

it('treats a region without an angle, or with 0, exactly as before', function () {
    $draw = function (array $region): string {
        $image = imagecreatetruecolor(400, 300);
        mt_srand(12);

        for ($y = 0; $y < 300; $y++) {
            for ($x = 0; $x < 400; $x++) {
                imagesetpixel($image, $x, $y, mt_rand(0, 0xFFFFFF));
            }
        }

        mt_srand();
        (new Pixelator)->pixelate($image, [$region]);
        ob_start();
        imagepng($image);

        return md5((string) ob_get_clean());
    };
    $plate = ['x' => 0.3, 'y' => 0.6, 'w' => 0.4, 'h' => 0.12];

    expect($draw([...$plate, 'angle' => 0]))->toBe($draw($plate));
});

it('clamps the angle to ±45°', function () {
    expect(Pixelator::angleOf(['x' => 0, 'y' => 0, 'w' => 1, 'h' => 1, 'angle' => 80]))->toBe(45.0)
        ->and(Pixelator::angleOf(['x' => 0, 'y' => 0, 'w' => 1, 'h' => 1]))->toBe(0.0);
});
