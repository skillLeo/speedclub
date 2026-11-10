<?php

namespace App\Services\Brand;

use App\Enums\BrandAssetKind;
use App\Models\BrandAsset;
use App\Models\Staff;
use App\Services\Media\ImageProcessor;
use finfo;
use Illuminate\Http\UploadedFile;
use Illuminate\Image\ImageException;
use Illuminate\Support\Facades\Image;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\ValidationException;
use RuntimeException;
use Throwable;

/**
 * Brand images of ADM-28, under the media rules of 05_ARCHITECTURE §9: JPEG, PNG or WebP only (by content, not by name), at most
 * speedclub.brand.max_upload_kb and speedclub.media.max_pixels, at least the kind's minimum size, re-encoded by GD so EXIF, GPS, ICC and
 * appended bytes never reach an output. Photos (hero, OG) go through App\Services\Media\ImageProcessor (clean JPEG original on the
 * private disk, WebP variants 320/640/1080/1600, blurhash); the OG default also gets its 1200×630 JPEG. Logos keep their alpha: a PNG
 * re-encode on the private disk, WebP variants and one public PNG (mail clients). File names carry a content hash, so URLs never go stale.
 */
final class BrandAssets
{
    private const TYPES = ['image/jpeg', 'image/png', 'image/webp'];

    public function __construct(private readonly ImageProcessor $processor) {}

    /**
     * @throws ValidationException
     */
    public function store(UploadedFile $file, BrandAssetKind $kind, Staff $by): BrandAsset
    {
        $bytes = $this->inspect($file, $kind);
        $hash = hash('sha256', $bytes);
        $directory = config()->string('speedclub.brand.directory').'/'.$kind->value;

        try {
            $files = $kind->isLogo() ? $this->logo($bytes, $directory) : $this->photo($bytes, $directory, $kind);
        } catch (ImageException) {
            throw ValidationException::withMessages(['file' => [(string) __('content.upload.unreadable')]]);
        }

        return BrandAsset::query()->create([
            'kind' => $kind,
            'sha256' => $hash,
            'bytes' => strlen($bytes),
            'uploaded_by' => $by->getKey(),
            ...$files,
        ]);
    }

    /**
     * The public path ("/storage/…" on a local disk, a full URL on S3) of the variant closest to $width: the smallest that is at least
     * as wide, else the widest. Paths become URLs per request (AppConfig), so a LAN client gets a reachable host.
     */
    public function path(BrandAsset $asset, int $width = 1080): ?string
    {
        $variants = $asset->variants;

        if ($variants === []) {
            return null;
        }

        ksort($variants, SORT_NUMERIC);
        $chosen = null;

        foreach ($variants as $variantWidth => $path) {
            $chosen = $path;

            if ((int) $variantWidth >= $width) {
                break;
            }
        }

        return $this->publicPath((string) $chosen);
    }

    /**
     * @return array<int, string> public path by width, smallest first
     */
    public function variantPaths(BrandAsset $asset): array
    {
        $paths = [];

        foreach ($asset->variants as $width => $path) {
            $paths[(int) $width] = $this->publicPath($path);
        }

        ksort($paths, SORT_NUMERIC);

        return $paths;
    }

    public function publicPath(string $path): string
    {
        $disk = config()->string('speedclub.brand.public_disk');

        return config('filesystems.disks.'.$disk.'.driver') === 'local' ? '/storage/'.$path : Storage::disk($disk)->url($path);
    }

    /**
     * @throws ValidationException
     */
    private function inspect(UploadedFile $file, BrandAssetKind $kind): string
    {
        Validator::make(['file' => $file], ['file' => ['required', 'file', 'max:'.config()->integer('speedclub.brand.max_upload_kb')]])->validate();

        $bytes = (string) $file->getContent();
        $type = (new finfo(FILEINFO_MIME_TYPE))->buffer($bytes);
        $size = @getimagesizefromstring($bytes);

        if (! in_array($type, self::TYPES, true) || $size === false) {
            throw ValidationException::withMessages(['file' => [(string) __('content.upload.type')]]);
        }

        [$width, $height] = $size;
        [$minWidth, $minHeight] = $kind->minimum();

        if ($width * $height > config()->integer('speedclub.media.max_pixels')) {
            throw ValidationException::withMessages(['file' => [(string) __('content.upload.too_many_pixels')]]);
        }

        if ($width < $minWidth || $height < $minHeight) {
            throw ValidationException::withMessages(['file' => [(string) __('content.upload.too_small', ['width' => $minWidth, 'height' => $minHeight])]]);
        }

        return $bytes;
    }

    /**
     * @return array{original_path: string, variants: array<int, string>, width: int, height: int, blurhash: string, og_path: string|null}
     */
    private function photo(string $bytes, string $directory, BrandAssetKind $kind): array
    {
        $image = $this->processor->process($bytes);
        $original = $directory.'/'.hash('sha256', $image->jpeg).'.jpg';
        $this->put(config()->string('speedclub.brand.private_disk'), $original, $image->jpeg, false);

        $variants = [];

        foreach ($image->variants as $width => $webp) {
            $path = $directory.'/'.hash('sha256', $webp).'-'.$width.'.webp';
            $this->put(config()->string('speedclub.brand.public_disk'), $path, $webp, true);
            $variants[(int) $width] = $path;
        }

        $og = null;

        if ($kind === BrandAssetKind::Og) {
            [$ogWidth, $ogHeight] = config()->array('speedclub.brand.og_size');
            $jpeg = Image::fromBytes($image->jpeg)->cover(max(1, (int) $ogWidth), max(1, (int) $ogHeight))->toJpeg()->quality(85)->toBytes();
            $og = $directory.'/'.hash('sha256', $jpeg).'-og.jpg';
            $this->put(config()->string('speedclub.brand.public_disk'), $og, $jpeg, true);
        }

        return [
            'original_path' => $original,
            'variants' => $variants,
            'width' => $image->width,
            'height' => $image->height,
            'blurhash' => $image->blurhash,
            'og_path' => $og,
        ];
    }

    /**
     * @return array{original_path: string, variants: array<int, string>, width: int, height: int, png_path: string}
     */
    private function logo(string $bytes, string $directory): array
    {
        $png = Image::fromBytes($bytes)->orient()->toPng()->toBytes();
        $size = getimagesizefromstring($png);

        if ($size === false) {
            throw new ImageException('The logo has no readable dimensions.');
        }

        [$width, $height] = $size;
        $original = $directory.'/'.hash('sha256', $png).'.png';
        $this->put(config()->string('speedclub.brand.private_disk'), $original, $png, false);

        $variants = [];
        /** @var list<int> $widths */
        $widths = config('speedclub.brand.logo_widths');

        foreach (array_filter($widths, fn (int $target): bool => $target <= $width) ?: [$width] as $target) {
            $webp = Image::fromBytes($png)->scale(width: max(1, $target))->toWebp()->quality(90)->toBytes();
            $path = $directory.'/'.hash('sha256', $webp).'-'.$target.'.webp';
            $this->put(config()->string('speedclub.brand.public_disk'), $path, $webp, true);
            $variants[$target] = $path;
        }

        $mail = Image::fromBytes($png)->scale(width: max(1, min($width, 640)))->toPng()->toBytes();
        $mailPath = $directory.'/'.hash('sha256', $mail).'-640.png';
        $this->put(config()->string('speedclub.brand.public_disk'), $mailPath, $mail, true);

        return ['original_path' => $original, 'variants' => $variants, 'width' => $width, 'height' => $height, 'png_path' => $mailPath];
    }

    private function put(string $disk, string $path, string $bytes, bool $public): void
    {
        try {
            $written = Storage::disk($disk)->put($path, $bytes, $public ? ['visibility' => 'public'] : []);
        } catch (Throwable $error) {
            throw new RuntimeException('A brand file could not be written.', 0, $error);
        }

        if ($written === false) {
            throw new RuntimeException("A brand file could not be written: $path");
        }
    }
}
