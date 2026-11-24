<?php

use App\Models\FeatureFlag;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;

/**
 * M5.5 Shop tests: flags, a configured store, fake disks and test images (a JPEG carrying an APP1 Exif segment with a marker).
 */
const SHOP_STORE = 'shop.example.test';

const SHOP_EXTRA = 'speedclub-test.myshopify.com';

/** @param array<string, bool> $flags */
function shopFlags(array $flags = []): void
{
    foreach ([...['shop' => true, 'editorial_samples' => true], ...$flags] as $key => $enabled) {
        FeatureFlag::query()->updateOrCreate(['key' => $key], ['enabled' => $enabled, 'description' => $key]);
    }

    request()->attributes->remove('speedclub.flags');
}

function shopStore(?string $domain = SHOP_STORE, ?string $extra = SHOP_EXTRA): void
{
    config(['speedclub.stickers.shop.domain' => $domain, 'speedclub.shop.extra_hosts' => $extra]);
}

/**
 * R4-3.2: opens every category, as the client will once clothing and accessories are on sale.
 */
function shopOpenCategories(): void
{
    config(['speedclub.shop.categories' => ['sticker' => 'available', 'apparel' => 'available', 'accessories' => 'available']]);
}

function shopFakeDisks(): void
{
    Storage::fake(config()->string('speedclub.shop.disk'));
    Storage::fake(config()->string('speedclub.shop.private_disk'));
}

function shopJpeg(int $width, int $height, string $marker = 'GPSLatitude=52.5200N-SECRET'): string
{
    $image = imagecreatetruecolor($width, $height);
    imagefilledrectangle($image, 0, 0, $width, $height, (int) imagecolorallocate($image, 20, 22, 26));
    // A bright band on the right third, so a crop around another focal point gives other pixels.
    imagefilledrectangle($image, (int) ($width * 2 / 3), 0, $width, $height, (int) imagecolorallocate($image, 230, 230, 230));
    ob_start();
    imagejpeg($image, null, 85);
    $jpeg = (string) ob_get_clean();
    $payload = "Exif\0\0MM\0*\0\0\0\x08".$marker;

    return substr($jpeg, 0, 2)."\xFF\xE1".pack('n', strlen($payload) + 2).$payload.substr($jpeg, 2);
}

function shopUpload(string $bytes, string $name = 'foto.jpg'): UploadedFile
{
    $path = tempnam(sys_get_temp_dir(), 'shop');
    file_put_contents($path, $bytes);

    return new UploadedFile($path, $name, null, null, true);
}
