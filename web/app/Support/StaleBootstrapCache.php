<?php

namespace App\Support;

/**
 * Hosts without SSH (ALL-INKL, ADR-539) update the code by FTP and only then run the web installer, which rebuilds the caches. Until
 * then the cached config of the previous release answered for code that may need new keys: on 2026-11-24 a new rate limit read at
 * boot (RateLimits) found no value in bootstrap/cache/config.php, every request answered 500, the installer page included.
 *
 * Called at the top of bootstrap/app.php, before the application reads a cache: a cached config, route or event file older than any
 * of its source files is deleted, so the next boot reads the uploaded sources (a little slower until the installer caches again).
 * About 60 stat calls a request; nothing is written while the caches are current.
 */
final class StaleBootstrapCache
{
    /**
     * Cache file (relative to bootstrap/cache) => source folders (relative to the base path) it was built from. Route and event
     * caches also depend on app/, but uploading a changed controller never makes a cached route unbootable; a new route does.
     *
     * @var array<string, list<string>>
     */
    public const SOURCES = [
        'config.php' => ['config'],
        'routes-v7.php' => ['routes'],
        'events.php' => ['app/Listeners', 'app/Providers'],
    ];

    /** @return list<string> the cache files it deleted (relative to bootstrap/cache) */
    public static function clear(string $basePath): array
    {
        $deleted = [];

        foreach (self::SOURCES as $cache => $folders) {
            $file = $basePath.'/bootstrap/cache/'.$cache;
            $cachedAt = is_file($file) ? filemtime($file) : false;

            if ($cachedAt === false) {
                continue;
            }

            foreach ($folders as $folder) {
                if (self::newestIn($basePath.'/'.$folder) > $cachedAt) {
                    if (unlink($file)) {
                        $deleted[] = $cache;
                    }

                    break;
                }
            }
        }

        return $deleted;
    }

    private static function newestIn(string $folder): int
    {
        if (! is_dir($folder)) {
            return 0;
        }

        $newest = 0;
        $files = new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator($folder, \FilesystemIterator::SKIP_DOTS));

        foreach ($files as $file) {
            if ($file instanceof \SplFileInfo && $file->isFile() && $file->getExtension() === 'php') {
                $newest = max($newest, (int) $file->getMTime());
            }
        }

        return $newest;
    }
}
