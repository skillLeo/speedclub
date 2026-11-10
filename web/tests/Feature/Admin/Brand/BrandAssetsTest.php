<?php

use App\Actions\Admin\Brand\UploadBrandAsset;
use App\Enums\BrandAssetKind;
use App\Models\AuditEvent;
use App\Models\BrandAsset;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\ValidationException;

require_once __DIR__.'/../Config/ConfigHelpers.php';

/**
 * ADM-28 uploads under the media rules: type by content, size and pixel limits, re-encode (EXIF gone), WebP variants, private original,
 * logos keep their alpha, the OG default gets its 1200×630 JPEG.
 */
beforeEach(function () {
    m35FakeDisks();
    $this->editor = m31Staff('content_editor');
    $this->upload = fn (UploadedFile $file, BrandAssetKind $kind = BrandAssetKind::Hero) => app(UploadBrandAsset::class)->handle($this->editor, $kind, $file);
});

/** A JPEG with an APP1 Exif segment holding a GPS-like marker right after SOI. */
function m35JpegWithExif(int $width, int $height, string $marker): string
{
    $image = imagecreatetruecolor($width, $height);
    imagefilledrectangle($image, 0, 0, $width, $height, imagecolorallocate($image, 20, 22, 26));
    ob_start();
    imagejpeg($image, null, 85);
    $jpeg = (string) ob_get_clean();
    $payload = "Exif\0\0MM\0*\0\0\0\x08".$marker;
    $segment = "\xFF\xE1".pack('n', strlen($payload) + 2).$payload;

    return substr($jpeg, 0, 2).$segment.substr($jpeg, 2);
}

function m35TempFile(string $bytes, string $name): UploadedFile
{
    $path = tempnam(sys_get_temp_dir(), 'm35');
    file_put_contents($path, $bytes);

    return new UploadedFile($path, $name, null, null, true);
}

it('re-encodes a hero: EXIF gone, private original, public WebP variants, blurhash, contrast measured, audited', function () {
    $file = m35TempFile(m35JpegWithExif(1600, 2400, 'GPSLatitude=52.5200N-SECRET'), 'hero.jpg');
    expect((string) file_get_contents($file->getPathname()))->toContain('SECRET');

    ['asset' => $asset, 'contrast' => $contrast] = ($this->upload)($file);

    expect($asset->kind)->toBe(BrandAssetKind::Hero)
        ->and(array_keys($asset->variants))->toBe([320, 640, 1080, 1600])
        ->and($asset->width)->toBe(1600)->and($asset->height)->toBe(2400)
        ->and($asset->blurhash)->not->toBeEmpty()
        ->and($contrast->passes())->toBeTrue();

    $private = Storage::disk(config('speedclub.brand.private_disk'));
    $public = Storage::disk(config('speedclub.brand.public_disk'));

    expect($private->exists($asset->original_path))->toBeTrue()->and($public->exists($asset->original_path))->toBeFalse()
        ->and($private->get($asset->original_path))->not->toContain('SECRET')->not->toContain('Exif');

    foreach ($asset->variants as $path) {
        expect($public->exists($path))->toBeTrue()->and($public->get($path))->not->toContain('SECRET')->and(str_ends_with($path, '.webp'))->toBeTrue();
    }

    $event = AuditEvent::query()->where('action', 'brand.asset_uploaded')->firstOrFail();
    expect($event->after)->toMatchArray(['kind' => 'hero', 'width' => 1600, 'height' => 2400])
        ->and($event->after['contrast']['passes'])->toBeTrue()
        ->and(json_encode($event->after))->not->toContain('brand/assets');
});

it('refuses what is not a JPEG, PNG or WebP image, whatever its name says', function (string $bytes, string $name) {
    expect(fn () => ($this->upload)(m35TempFile($bytes, $name)))->toThrow(ValidationException::class);
    expect(BrandAsset::query()->count())->toBe(0);
})->with([
    'text as jpg' => ['Das ist kein Bild.', 'hero.jpg'],
    'svg' => ['<svg xmlns="http://www.w3.org/2000/svg" width="2000" height="2000"><script>alert(1)</script></svg>', 'logo.svg'],
    'gif' => [base64_decode('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'), 'hero.gif'],
]);

it('refuses a file above the size limit and an image below the minimum size', function () {
    config(['speedclub.brand.max_upload_kb' => 10]);
    expect(fn () => ($this->upload)(m35TempFile(m35JpegWithExif(1600, 2400, 'x').str_repeat("\0", 20000), 'big.jpg')))->toThrow(ValidationException::class);

    config(['speedclub.brand.max_upload_kb' => 15360]);
    expect(fn () => ($this->upload)(m35TempFile(m35JpegWithExif(800, 600, 'x'), 'small.jpg')))
        ->toThrow(fn (ValidationException $e) => expect($e->errors()['file'][0])->toContain('1080'));
});

it('keeps a logo transparent and adds a PNG for mail clients', function () {
    $image = imagecreatetruecolor(1200, 360);
    imagesavealpha($image, true);
    imagefill($image, 0, 0, imagecolorallocatealpha($image, 0, 0, 0, 127));
    imagefilledrectangle($image, 400, 100, 800, 260, imagecolorallocatealpha($image, 255, 255, 255, 0));
    ob_start();
    imagepng($image);
    $png = (string) ob_get_clean();

    ['asset' => $asset, 'contrast' => $contrast] = ($this->upload)(m35TempFile($png, 'logo.png'), BrandAssetKind::WordmarkWhite);

    expect($contrast)->toBeNull()->and(array_keys($asset->variants))->toBe([160, 320, 640])->and($asset->png_path)->not->toBeNull();

    $variant = imagecreatefromstring((string) Storage::disk(config('speedclub.brand.public_disk'))->get($asset->variants[640]));
    $corner = imagecolorsforindex($variant, imagecolorat($variant, 2, 2));
    expect($corner['alpha'])->toBe(127);
});

it('cuts the OG default to 1200×630', function () {
    ['asset' => $asset] = ($this->upload)(m35TempFile(m35JpegWithExif(2400, 1600, 'x'), 'og.jpg'), BrandAssetKind::Og);

    $size = getimagesizefromstring((string) Storage::disk(config('speedclub.brand.public_disk'))->get($asset->og_path));
    expect([$size[0], $size[1], $size['mime']])->toBe([1200, 630, 'image/jpeg']);
});

it('checks brand.manage inside', function (string $role, bool $allowed) {
    $run = fn () => app(UploadBrandAsset::class)->handle(m31Staff($role), BrandAssetKind::Hero, m35TempFile(m35JpegWithExif(1200, 1800, 'x'), 'hero.jpg'));

    $allowed ? expect($run()['asset'])->toBeInstanceOf(BrandAsset::class) : expect($run)->toThrow(AuthorizationException::class);
})->with(m35Matrix('brand.manage'));
