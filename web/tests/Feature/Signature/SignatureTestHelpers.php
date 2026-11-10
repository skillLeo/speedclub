<?php

use App\Models\FeatureFlag;
use App\Models\Media;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\Media\MediaService;
use App\Services\Qr\QrCodes;
use Illuminate\Http\UploadedFile;

require_once __DIR__.'/../Garage/GarageTestHelpers.php';

/**
 * M2.7 signature feature helpers, prefixed sig… so they never collide with another file's functions.
 */
function sigFlag(string $key, bool $enabled = true): void
{
    FeatureFlag::query()->updateOrCreate(['key' => $key], ['enabled' => $enabled]);
}

/**
 * A JPEG with fine detail everywhere: an 8 px checkerboard over a colour gradient, coarse enough to stay in the 320 px variant. Pixelation
 * averages it away, re-encoding does not.
 */
function sigDetailedJpeg(int $width = 1200, int $height = 800): string
{
    $image = imagecreatetruecolor($width, $height);
    $cell = 8;

    for ($y = 0; $y < $height; $y += $cell) {
        for ($x = 0; $x < $width; $x += $cell) {
            $color = intdiv($x + $y, $cell) % 2 === 0
                ? (int) imagecolorallocate($image, 255, (int) (255 * $x / $width), (int) (255 * $y / $height))
                : (int) imagecolorallocate($image, 0, 0, 0);
            imagefilledrectangle($image, $x, $y, $x + $cell - 1, $y + $cell - 1, $color);
        }
    }

    ob_start();
    imagejpeg($image, null, 95);

    return (string) ob_get_clean();
}

/**
 * A published vehicle whose cover is a real, processed photo on the (faked) disks.
 *
 * @return array{0: Vehicle, 1: Media}
 */
function sigVehicleWithPhoto(?User $owner = null, ?string $bytes = null): array
{
    $owner ??= User::factory()->create(['username' => 'finn.jdm']);
    $vehicle = Vehicle::factory()->published()->create(['owner_id' => $owner->id]);
    $media = app(MediaService::class)->storeFromUpload(UploadedFile::fake()->createWithContent('auto.jpg', $bytes ?? sigDetailedJpeg()), $owner, $vehicle);
    $vehicle->forceFill(['cover_media_id' => $media->id])->save();
    app(QrCodes::class)->ensureActive($vehicle);

    return [$vehicle->refresh(), $media->refresh()];
}

/**
 * The mean absolute difference of two images over a rectangle in pixels, 0 to 255 per channel.
 */
function sigDifference(string $first, string $second, int $left, int $top, int $width, int $height): float
{
    $a = imagecreatefromstring($first);
    $b = imagecreatefromstring($second);
    $sum = 0;
    $count = 0;

    for ($y = $top; $y < $top + $height; $y += 3) {
        for ($x = $left; $x < $left + $width; $x += 3) {
            $ca = (int) imagecolorat($a, $x, $y);
            $cb = (int) imagecolorat($b, $x, $y);
            $sum += abs((($ca >> 16) & 255) - (($cb >> 16) & 255)) + abs((($ca >> 8) & 255) - (($cb >> 8) & 255)) + abs(($ca & 255) - ($cb & 255));
            $count += 3;
        }
    }

    return $sum / max(1, $count);
}

/**
 * How much neighbouring pixels differ inside a rectangle: high for fine detail, near 0 for flat blocks.
 */
function sigDetail(string $bytes, int $left, int $top, int $width, int $height): float
{
    $image = imagecreatefromstring($bytes);
    $sum = 0;
    $count = 0;

    for ($y = $top; $y < $top + $height - 1; $y += 3) {
        for ($x = $left; $x < $left + $width - 1; $x += 3) {
            $sum += abs((((int) imagecolorat($image, $x, $y)) >> 16 & 255) - (((int) imagecolorat($image, $x + 1, $y)) >> 16 & 255));
            $count++;
        }
    }

    return $sum / max(1, $count);
}
