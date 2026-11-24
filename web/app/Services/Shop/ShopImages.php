<?php

namespace App\Services\Shop;

use App\Models\ShopBanner;
use App\Models\ShopProductImage;
use App\Services\Media\ImageProcessor;
use App\Services\Media\ProcessedImage;
use App\Services\Shop\Views\ShopImageView;
use finfo;
use Illuminate\Http\UploadedFile;
use Illuminate\Image\ImageException;
use Illuminate\Support\Facades\Image;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use RuntimeException;
use Throwable;

/**
 * Shop photos of ADM-66/67 under the media rules of 05_ARCHITECTURE §9 (m5.5-contract §1): JPEG, PNG or WebP by content (never by name),
 * at most speedclub.shop.image.max_upload_kb and speedclub.media.max_pixels, re-encoded by App\Services\Media\ImageProcessor (GD writes
 * pixels only, so EXIF, GPS, ICC and appended bytes never reach an output). The clean uncropped JPEG is the private original; product
 * photos are cropped to 4:5 around the focal point and every public WebP variant (320/640/1080/1600) and the blurhash come from that
 * crop, so a new focal point re-derives them without a new upload. Banners keep their ratio.
 *
 * File names (m5.5-contract §6, review MF-1): every write gets a fresh ULID, so no two rows ever share a file, even for the same photo
 * uploaded twice (GD re-encoding is deterministic, so a content hash would give equal names): originals `shop/originals/{ulid}.jpg`,
 * product variants `shop/{product}/{ulid}-{w}.webp`, banner variants `shop/banners/{ulid}-{w}.webp`. The ULID also busts caches. delete()
 * keeps any file that a row still names (rows written before this rule may share files).
 *
 * @phpstan-type ImageColumns array{width: int, height: int, original_width: int, original_height: int, focal_x: float, focal_y: float, blurhash: string, original_path: string, variants: array<int, string>, sha256: string, bytes: int}
 */
final class ShopImages
{
    private const TYPES = ['image/jpeg', 'image/png', 'image/webp'];

    /** Width over height of a product photo. */
    public const PRODUCT_RATIO = 0.8;

    public function __construct(private readonly ImageProcessor $processor) {}

    /**
     * The upload's bytes after the type, size and pixel checks.
     *
     * @throws ValidationException
     */
    public function read(UploadedFile $file): string
    {
        $bytes = (string) $file->getContent();

        if (strlen($bytes) > config()->integer('speedclub.shop.image.max_upload_kb') * 1024) {
            throw ValidationException::withMessages(['file' => [(string) __('shop.upload.too_large', ['max' => (int) (config()->integer('speedclub.shop.image.max_upload_kb') / 1024)])]]);
        }

        return $this->inspect($bytes);
    }

    /**
     * @throws ValidationException
     */
    public function inspect(string $bytes): string
    {
        $type = (new finfo(FILEINFO_MIME_TYPE))->buffer($bytes);
        $size = @getimagesizefromstring($bytes);

        if (! in_array($type, self::TYPES, true) || $size === false) {
            throw ValidationException::withMessages(['file' => [(string) __('content.upload.type')]]);
        }

        if (config()->integer('speedclub.media.max_pixels') < $size[0] * $size[1]) {
            throw ValidationException::withMessages(['file' => [(string) __('content.upload.too_many_pixels')]]);
        }

        return $bytes;
    }

    /**
     * A product photo: clean original, then the 4:5 crop around the focal point.
     *
     * @return ImageColumns
     *
     * @throws ValidationException
     */
    public function product(string $productId, string $bytes, float $focalX = 0.5, float $focalY = 0.5): array
    {
        $clean = $this->clean($bytes);
        [$minWidth, $minHeight] = $this->productMinimum();
        [$cropWidth, $cropHeight] = self::cropSize($clean->width, $clean->height);

        if ($cropWidth < $minWidth || $cropHeight < $minHeight) {
            throw ValidationException::withMessages(['file' => [(string) __('shop.upload.too_small', ['width' => $minWidth, 'height' => $minHeight])]]);
        }

        $original = $this->originalPath();
        $this->put($this->privateDisk(), $original, $clean->jpeg, false);

        try {
            return [...$this->crop($productId, $clean->jpeg, $clean->width, $clean->height, $focalX, $focalY), 'original_path' => $original, 'sha256' => hash('sha256', $bytes), 'bytes' => strlen($bytes)];
        } catch (Throwable $error) {
            Storage::disk($this->privateDisk())->delete($original);

            throw $error;
        }
    }

    /**
     * A new focal point for a stored product photo: the crop and its variants again from the private original. The old variant files are
     * left to the caller (removed once the row holds the new ones).
     *
     * @return array{width: int, height: int, original_width: int, original_height: int, focal_x: float, focal_y: float, blurhash: string, variants: array<int, string>}
     */
    public function recrop(ShopProductImage $image, float $focalX, float $focalY): array
    {
        $jpeg = Storage::disk($this->privateDisk())->get($image->original_path);

        if (! is_string($jpeg) || $jpeg === '') {
            throw new RuntimeException('The private original of a shop photo is missing.');
        }

        return $this->crop($image->shop_product_id, $jpeg, $image->original_width, $image->original_height, $focalX, $focalY);
    }

    /**
     * A banner photo: not cropped (full-bleed; the app crops with the focal point), at least banner_min_width wide, ratio 4:5 … 21:9.
     *
     * @return ImageColumns
     *
     * @throws ValidationException
     */
    public function banner(string $bytes, float $focalX = 0.5, float $focalY = 0.5): array
    {
        $clean = $this->clean($bytes);
        $minWidth = config()->integer('speedclub.shop.image.banner_min_width');
        [$minRatio, $maxRatio] = config()->array('speedclub.shop.image.banner_ratio');
        $ratio = $clean->width / max(1, $clean->height);

        if ($clean->width < $minWidth) {
            throw ValidationException::withMessages(['file' => [(string) __('shop.upload.banner_too_small', ['width' => $minWidth])]]);
        }

        if ($ratio < (float) $minRatio || $ratio > (float) $maxRatio) {
            throw ValidationException::withMessages(['file' => [(string) __('shop.upload.banner_ratio')]]);
        }

        $original = $this->originalPath();
        $this->put($this->privateDisk(), $original, $clean->jpeg, false);

        try {
            $variants = $this->storeVariants('banners', $clean->variants);
        } catch (Throwable $error) {
            Storage::disk($this->privateDisk())->delete($original);

            throw $error;
        }

        return [
            'width' => $clean->width,
            'height' => $clean->height,
            'original_width' => $clean->width,
            'original_height' => $clean->height,
            'focal_x' => self::unit($focalX),
            'focal_y' => self::unit($focalY),
            'blurhash' => $clean->blurhash,
            'original_path' => $original,
            'variants' => $variants,
            'sha256' => hash('sha256', $bytes),
            'bytes' => strlen($bytes),
        ];
    }

    /**
     * Removes public variants and, when given, the private original, except any file a shop row still names (call it after the row
     * that held the files is gone or holds new ones). Missing files are fine (idempotent purge).
     *
     * @param  array<int|string, string>  $variants
     */
    public function delete(array $variants, ?string $original = null): void
    {
        $paths = array_values(array_diff(array_filter($variants, fn (string $path): bool => $path !== ''), $this->stillReferenced($variants)));

        if ($paths !== []) {
            Storage::disk($this->publicDisk())->delete($paths);
        }

        if ($original !== null && $original !== '' && $this->stillReferenced([], $original) === []) {
            Storage::disk($this->privateDisk())->delete($original);
        }
    }

    /**
     * The given paths that a shop_product_images or shop_banners row still names. A variant list is JSON (slashes may be escaped), so
     * a variant is matched by its file name, which holds no LIKE wildcard (ULID or hash, width, extension).
     *
     * @param  array<int|string, string>  $variants
     * @return list<string>
     */
    public function stillReferenced(array $variants, ?string $original = null): array
    {
        $referenced = [];

        foreach (array_filter([...array_values($variants), $original]) as $path) {
            $name = basename((string) $path);

            if ($name === '' || preg_match('/\A[0-9A-Za-z.-]+\z/', $name) !== 1) {
                continue;
            }

            foreach ([ShopProductImage::query(), ShopBanner::query()] as $query) {
                if ($query->where(fn ($any) => $any->where('original_path', $path)->orWhere('variants', 'like', '%'.$name.'%'))->exists()) {
                    $referenced[] = (string) $path;
                    break;
                }
            }
        }

        return $referenced;
    }

    public function view(ShopProductImage|ShopBanner $image): ShopImageView
    {
        $variants = [];
        $paths = $image->variants;
        ksort($paths, SORT_NUMERIC);

        foreach ($paths as $width => $path) {
            $variants[] = [
                'width' => (int) $width,
                'height' => $image->width > 0 ? (int) round((int) $width * $image->height / $image->width) : 0,
                'url' => $this->url($path),
            ];
        }

        return new ShopImageView(
            id: $image->id,
            width: $image->width,
            height: $image->height,
            aspect: $image instanceof ShopProductImage ? '4:5' : self::aspect($image->width, $image->height),
            blurhash: $image->blurhash,
            thumbhash: $image->thumbhash,
            focalX: round($image->focal_x, 3),
            focalY: round($image->focal_y, 3),
            alt: $image->alt,
            variants: $variants,
        );
    }

    /**
     * The URL of the variant closest to $width: the smallest at least as wide, else the widest.
     */
    public function variantUrl(ShopProductImage|ShopBanner $image, int $width): string
    {
        $variants = $image->variants;
        ksort($variants, SORT_NUMERIC);
        $chosen = '';

        foreach ($variants as $variantWidth => $path) {
            $chosen = $path;

            if ((int) $variantWidth >= $width) {
                break;
            }
        }

        return $this->url($chosen);
    }

    /**
     * The URL of one public variant (the admin list's thumbnail). Local disks answer on the host of the current request.
     */
    public function url(string $path): string
    {
        $disk = $this->publicDisk();

        return config('filesystems.disks.'.$disk.'.driver') === 'local' ? url('storage/'.$path) : Storage::disk($disk)->url($path);
    }

    /**
     * The widest crop of the given ratio inside width × height.
     *
     * @return array{int<1, max>, int<1, max>}
     */
    public static function cropSize(int $width, int $height): array
    {
        if ($width / max(1, $height) > self::PRODUCT_RATIO) {
            return [max(1, (int) floor($height * self::PRODUCT_RATIO)), max(1, $height)];
        }

        return [max(1, $width), max(1, (int) floor($width / self::PRODUCT_RATIO))];
    }

    /**
     * "16:9", "3:2", "4:5" … for common ratios, else the reduced fraction.
     */
    public static function aspect(int $width, int $height): string
    {
        $ratio = $width / max(1, $height);

        foreach (['21:9' => 21 / 9, '2:1' => 2.0, '16:9' => 16 / 9, '3:2' => 1.5, '4:3' => 4 / 3, '1:1' => 1.0, '4:5' => 0.8] as $name => $known) {
            if (abs($ratio - $known) < 0.01) {
                return $name;
            }
        }

        $a = max(1, $width);
        $b = max(1, $height);

        while ($b !== 0) {
            [$a, $b] = [$b, $a % $b];
        }

        return intdiv($width, $a).':'.intdiv($height, $a);
    }

    /**
     * @return array{width: int, height: int, original_width: int, original_height: int, focal_x: float, focal_y: float, blurhash: string, variants: array<int, string>}
     */
    private function crop(string $productId, string $jpeg, int $width, int $height, float $focalX, float $focalY): array
    {
        $focalX = self::unit($focalX);
        $focalY = self::unit($focalY);
        [$cropWidth, $cropHeight] = self::cropSize($width, $height);
        $x = (int) round(min(max(0.0, $focalX * $width - $cropWidth / 2), $width - $cropWidth));
        $y = (int) round(min(max(0.0, $focalY * $height - $cropHeight / 2), $height - $cropHeight));

        try {
            $cropped = Image::fromBytes($jpeg)->crop($cropWidth, $cropHeight, x: $x, y: $y)->toJpeg()->quality(95)->toBytes();
            $image = $this->processor->process($cropped);
        } catch (ImageException) {
            throw ValidationException::withMessages(['file' => [(string) __('content.upload.unreadable')]]);
        }

        return [
            'width' => $image->width,
            'height' => $image->height,
            'original_width' => $width,
            'original_height' => $height,
            'focal_x' => $focalX,
            'focal_y' => $focalY,
            'blurhash' => $image->blurhash,
            'variants' => $this->storeVariants($productId, $image->variants),
        ];
    }

    /**
     * @throws ValidationException
     */
    private function clean(string $bytes): ProcessedImage
    {
        try {
            return $this->processor->process($bytes);
        } catch (ImageException) {
            throw ValidationException::withMessages(['file' => [(string) __('content.upload.unreadable')]]);
        }
    }

    /**
     * The WebP variants on the public disk under shop/{folder}, all named with one fresh ULID.
     *
     * @param  string  $folder  the product id, or `banners`
     * @param  array<int, string>  $webps
     * @return array<int, string>
     */
    private function storeVariants(string $folder, array $webps): array
    {
        $paths = [];
        $key = strtolower((string) Str::ulid());

        try {
            foreach ($webps as $width => $webp) {
                $path = $this->directory($folder).'/'.$key.'-'.$width.'.webp';
                $this->put($this->publicDisk(), $path, $webp, true);
                $paths[(int) $width] = $path;
            }
        } catch (Throwable $error) {
            $this->delete($paths);

            throw $error;
        }

        ksort($paths, SORT_NUMERIC);

        return $paths;
    }

    /**
     * @return array{int, int}
     */
    private function productMinimum(): array
    {
        [$width, $height] = config()->array('speedclub.shop.image.product_min');

        return [(int) $width, (int) $height];
    }

    private static function unit(float $value): float
    {
        return round(min(1.0, max(0.0, $value)), 3);
    }

    private function originalPath(): string
    {
        return $this->directory('originals').'/'.strtolower((string) Str::ulid()).'.jpg';
    }

    private function directory(string $kind): string
    {
        return config()->string('speedclub.shop.directory').'/'.$kind;
    }

    private function publicDisk(): string
    {
        return config()->string('speedclub.shop.disk');
    }

    private function privateDisk(): string
    {
        return config()->string('speedclub.shop.private_disk');
    }

    private function put(string $disk, string $path, string $bytes, bool $public): void
    {
        try {
            $written = Storage::disk($disk)->put($path, $bytes, $public ? ['visibility' => 'public'] : []);
        } catch (Throwable $error) {
            throw new RuntimeException('A shop file could not be written.', 0, $error);
        }

        if ($written === false) {
            throw new RuntimeException("A shop file could not be written: $path");
        }
    }
}
