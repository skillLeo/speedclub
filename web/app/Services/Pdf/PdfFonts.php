<?php

namespace App\Services\Pdf;

use Barryvdh\DomPDF\PDF;
use Closure;
use Dompdf\FontMetrics;

/**
 * Registers the bundled TTFs of resources/fonts with dompdf, for the QR sticker sheet and the placard (ADR-402).
 *
 * dompdf keeps a copy and the metrics of each font in storage/fonts, named after the source PATH, never its content, and never looks
 * at the source again once a family is registered. Parsing a TTF takes seconds, so a registered font is reused, but only while its copy
 * is still the bundled file: a font replaced under the same name (Inter 4.001 → 4.1 in M4.1) would otherwise print the old one forever,
 * and an entry whose metrics are gone (storage/fonts copied from another host or path) would fall back to a core font. Checking is
 * lock-free; replacing runs under an flock and checks again first, because dompdf writes a copy in several non-atomic steps.
 */
final class PdfFonts
{
    /** In the font dir: held while a request replaces or registers a font, so a parallel one never deletes a copy still being written. */
    public const LOCK = '.speedclub-fonts.lock';

    private const COPIES = ['.ttf', '.ufm', '.ufm.json'];

    /**
     * @param  list<array{family: string, weight: string, variant: string, file: string}>  $fonts
     */
    public static function register(PDF $pdf, array $fonts): void
    {
        $metrics = $pdf->getDomPDF()->getFontMetrics();
        $fontDir = realpath($pdf->getDomPDF()->getOptions()->getFontDir());

        foreach ($fonts as $font) {
            // The steady state: the copy is current, no lock is taken.
            if (self::installedCurrent($metrics, $font)) {
                continue;
            }

            self::locked($fontDir, function () use ($metrics, $font, $fontDir): void {
                // Another request may have registered the font while this one waited: read the family table again from disk.
                $metrics->loadFontFamilies();
                $metrics->setFontFamilies();

                if (self::installedCurrent($metrics, $font)) {
                    return;
                }

                self::replace($metrics, $font, $fontDir);
            });
        }
    }

    /**
     * @param  array{family: string, weight: string, variant: string, file: string}  $font
     */
    private static function installedCurrent(FontMetrics $metrics, array $font): bool
    {
        $installed = $metrics->getFontFamilies()[mb_strtolower($font['family'])][$font['variant']] ?? null;

        return is_string($installed) && self::current($installed, resource_path('fonts/'.$font['file']));
    }

    /**
     * @param  array{family: string, weight: string, variant: string, file: string}  $font
     */
    private static function replace(FontMetrics $metrics, array $font, string|false $fontDir): void
    {
        $family = mb_strtolower($font['family']);
        $installed = $metrics->getFontFamilies()[$family][$font['variant']] ?? null;

        if (is_string($installed)) {
            // Only dompdf's own copies in the font cache are ever removed.
            $directory = realpath(dirname($installed));

            if ($fontDir !== false && $directory === $fontDir) {
                foreach (self::COPIES as $extension) {
                    if (is_file($installed.$extension)) {
                        unlink($installed.$extension);
                    }
                }
            }

            // registerFont() returns early while the family still names the cached copy.
            $entry = $metrics->getFontFamilies()[$family];
            unset($entry[$font['variant']]);
            $metrics->setFontFamily($family, $entry);
        }

        $metrics->registerFont(['family' => $font['family'], 'weight' => $font['weight'], 'style' => 'normal'], resource_path('fonts/'.$font['file']));
    }

    /**
     * An exclusive flock on a file in the font dir (flock works on the shared host). Without a font dir, or when the lock file cannot
     * be opened there (a read-only dir, a directory in its place), dompdf cannot write a copy either, so the callback runs unlocked
     * and fails the way it always did; so it does where a host disables flock. N-3: the open is silenced, because Laravel's error
     * handler turns its warning into an exception and the unlocked path would never run.
     *
     * @param  Closure(): void  $callback
     */
    private static function locked(string|false $fontDir, Closure $callback): void
    {
        $handle = $fontDir === false || ! function_exists('flock') ? false : @fopen($fontDir.'/'.self::LOCK, 'c');

        if ($handle === false) {
            $callback();

            return;
        }

        try {
            flock($handle, LOCK_EX);
            $callback();
        } finally {
            flock($handle, LOCK_UN);
            fclose($handle);
        }
    }

    private static function current(string $installed, string $source): bool
    {
        return is_file($installed.'.ufm')
            && is_file($installed.'.ttf')
            && hash_file('xxh128', $installed.'.ttf') === hash_file('xxh128', $source);
    }
}
