<?php

namespace App\Support;

use Illuminate\Support\Facades\Cache;

/**
 * The client's logo files in public/brand (written by design/scripts/build-brand.mjs).
 *
 * Client round 3 (2026-11-19): the files keep their names when the logo changes, and the host serves them with a week of cache (and a
 * CDN in front), so a browser, a mail client or the app kept showing the old logo. Every link to them carries the file's content hash
 * (`?v=`), so a new logo is a new address at once. The wide logo's ratio is read from the file too, never written down.
 */
final class BrandFiles
{
    /** @var array<string, string> */
    private static array $versions = [];

    private static ?float $wideRatio = null;

    /** The absolute URL of a file under public/, with its content hash; the bare URL when the file is missing. */
    public static function url(string $path): string
    {
        $path = ltrim($path, '/');

        return url('/'.$path).self::query($path);
    }

    /** As url(), through asset() (the same host for a page). */
    public static function asset(string $path): string
    {
        $path = ltrim($path, '/');

        return asset($path).self::query($path);
    }

    /** The root-relative path with its content hash (for links built on another base, as the mails do). */
    public static function path(string $path): string
    {
        $path = ltrim($path, '/');

        return '/'.$path.self::query($path);
    }

    /**
     * What a cached server-drawn picture (OG image, share card, Wrapped card) must be keyed by besides its own content: the logo files
     * it draws, so a new logo draws them anew instead of serving the old one.
     */
    public static function logoVersion(): string
    {
        return self::query('brand/logo-wide-white-1280.png').self::query('brand/logo-wide-white-640.png').self::query('brand/logo-wide-black-640.png');
    }

    /** Width over height of the wide logo, from the largest file the brand script writes. */
    public static function wideRatio(): float
    {
        if (self::$wideRatio !== null) {
            return self::$wideRatio;
        }

        $size = @getimagesize(public_path('brand/logo-wide-white-1280.png'));

        return self::$wideRatio = is_array($size) && $size[0] > 0 && $size[1] > 0 ? $size[0] / $size[1] : 1280 / 338;
    }

    /** Forgets what was read (tests, or after the brand script ran in the same process). */
    public static function forget(): void
    {
        self::$versions = [];
        self::$wideRatio = null;
    }

    private static function query(string $path): string
    {
        if (! array_key_exists($path, self::$versions)) {
            $file = public_path($path);
            $stat = is_file($file) ? @stat($file) : false;
            // Review nit 12: hashed once per file version (time and size), not on every request; the large OG source included.
            $hash = is_array($stat)
                ? Cache::rememberForever('brand-file:'.$path.':'.$stat['mtime'].':'.$stat['size'], fn (): string => (string) hash_file('xxh3', $file))
                : '';
            self::$versions[$path] = $hash !== '' ? '?v='.substr($hash, 0, 10) : '';
        }

        return self::$versions[$path];
    }
}
