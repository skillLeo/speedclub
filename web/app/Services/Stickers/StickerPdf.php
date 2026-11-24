<?php

namespace App\Services\Stickers;

use App\Services\Pdf\PdfFonts;
use Barryvdh\DomPDF\PDF;
use Dompdf\Cpdf;
use Illuminate\Support\Facades\File;
use RuntimeException;

/**
 * The print-ready PDF of a sticker (m5.4-contract §6.2), drawn straight onto dompdf's canvas from the same artwork as the SVG and the
 * Scan-Test raster. Page 1 is the print: the trim at its exact size inside 3 mm bleed and a slug with crop marks, the die line as a
 * magenta hairline, the design id and the production notes; /TrimBox and /BleedBox say where the sticker and the bleed are. Page 2 is a
 * proof on the surface the sticker is made for, marked "nicht drucken". Text keeps its fonts (subset, embedded); the code is vector.
 *
 * @phpstan-type Slug array{reference: string, version: int, lines: list<string>, proof: string}
 */
final class StickerPdf
{
    /** @var list<array{family: string, weight: string, variant: string, file: string}> */
    private const FONTS = [
        ['family' => 'Inter', 'weight' => '400', 'variant' => 'normal', 'file' => StickerFonts::SLUG],
        ['family' => 'Inter', 'weight' => '500', 'variant' => '500', 'file' => StickerFonts::LINE],
        ['family' => 'Inter Display', 'weight' => '600', 'variant' => '600', 'file' => StickerFonts::USERNAME],
        ['family' => 'Archivo SemiExpanded', 'weight' => '600', 'variant' => '600', 'file' => StickerFonts::CAR_NAME],
    ];

    private const PT_PER_MM = 72 / 25.4;

    private const CROP_MARK_MM = 5.0;

    private const CROP_GAP_MM = 1.0;

    private const SLUG_SIZE_PT = 5.5;

    private const SLUG_INSET_MM = 3.0;

    /** @var array<string, string> font file => dompdf font path */
    private array $fontPaths = [];

    /**
     * @param  Slug  $slug
     */
    public function render(StickerArtwork $artwork, array $slug): string
    {
        File::ensureDirectoryExists(storage_path('fonts'));

        /** @var PDF $wrapper */
        $wrapper = app('dompdf.wrapper');
        $wrapper->setOption('isFontSubsettingEnabled', true);
        PdfFonts::register($wrapper, self::FONTS);

        $bleed = config()->float('speedclub.stickers.bleed_mm', 3.0);
        $margin = config()->float('speedclub.stickers.slug_mm', 12.0);
        $offset = $bleed + $margin;
        $pageWidth = ($artwork->width + 2 * $offset) * self::PT_PER_MM;
        $rows = $this->rows($slug['lines'], $pageWidth - 2 * self::SLUG_INSET_MM * self::PT_PER_MM);
        // The slug text sits under the bottom crop marks; a narrow sticker needs more rows, so the page grows downwards.
        $needed = $bleed + self::CROP_GAP_MM + self::CROP_MARK_MM + 2.2 + count($rows) * self::SLUG_SIZE_PT * 1.3 / self::PT_PER_MM + 2.0;
        $bottom = max($offset, $needed);
        $pageHeight = ($artwork->height + $offset + $bottom) * self::PT_PER_MM;

        $wrapper->loadHTML('<!doctype html><html><head><style>@page{margin:0}</style></head><body></body></html>');
        $wrapper->setPaper([0, 0, $pageWidth, $pageHeight]);
        $dompdf = $wrapper->getDomPDF();
        $dompdf->render();

        $metrics = $dompdf->getFontMetrics();

        foreach (self::FONTS as $font) {
            $path = $metrics->getFont($font['family'], $font['variant']);

            if (! is_string($path)) {
                throw new RuntimeException("The sticker font [{$font['file']}] is not registered.");
            }

            $this->fontPaths[$font['file']] = $path;
        }

        /** @var \Dompdf\Adapter\CPDF $canvas */
        $canvas = $dompdf->getCanvas();
        $pdf = $canvas->get_cpdf();
        $pdf->addInfo('Title', 'Speedclub Sticker '.$slug['reference'].' v'.$slug['version']);
        $pdf->addInfo('Creator', 'Speedclub');
        $pdf->addInfo('Producer', 'Speedclub');

        $this->artwork($pdf, $artwork, $offset, $pageHeight, false);
        $this->cutContour($pdf, $artwork, $offset, $pageHeight);
        $this->cropMarks($pdf, $artwork, $offset, $bleed, $pageHeight);
        $this->slug($pdf, $rows, $offset, $pageHeight, $artwork);

        $canvas->new_page();
        $this->proof($pdf, $artwork, $offset, $bottom, $pageHeight, $pageWidth);
        $this->slug($pdf, [$slug['proof']], $offset, $pageHeight, $artwork);

        return self::withPrintBoxes((string) $dompdf->output(), $artwork, $offset, $bottom, $bleed);
    }

    private function artwork(Cpdf $pdf, StickerArtwork $artwork, float $offset, float $pageHeight, bool $proof): void
    {
        $pdf->saveState();

        if ($artwork->mirrored && ! $proof) {
            $centre = ($offset + $artwork->width / 2) * self::PT_PER_MM;
            $pdf->transform([-1, 0, 0, 1, 2 * $centre, 0]);
        }

        // White vinyl is the material, not an ink: it shows on the proof only.
        foreach ($artwork->elements as $element) {
            $this->element($pdf, $artwork, $element, $offset, $pageHeight);
        }

        $pdf->restoreState();
    }

    /**
     * @param  array<string, mixed>  $element
     */
    private function element(Cpdf $pdf, StickerArtwork $artwork, array $element, float $offset, float $pageHeight): void
    {
        $x = ($offset + (float) $element['x']) * self::PT_PER_MM;
        $top = $pageHeight - ($offset + (float) ($element['y'] ?? 0.0)) * self::PT_PER_MM;
        $ink = (string) ($element['ink'] ?? $artwork->mainInk());
        $this->colour($pdf, StickerInks::rgb($ink));

        switch ($element['kind']) {
            case 'logo':
                $w = (float) ($element['w'] ?? 0.0) * self::PT_PER_MM;
                $h = (float) ($element['h'] ?? 0.0) * self::PT_PER_MM;

                if (($element['rotate'] ?? 0) === 90) {
                    // A quarter turn clockwise: the logo's length runs down the box, the tops of its letters face right.
                    $this->image($pdf, StickerLogo::file($ink), [0, -$h, $w, 0, $x, $top]);

                    return;
                }

                $this->image($pdf, StickerLogo::file($ink), [$w, 0, 0, $h, $x, $top - $h]);

                return;

            case 'bar':
                $h = (float) ($element['h'] ?? 0.0) * self::PT_PER_MM;
                $pdf->filledRectangle($x, $top - $h, (float) ($element['w'] ?? 0.0) * self::PT_PER_MM, $h);

                return;

            case 'text':
                $pdf->selectFont($this->fontPaths[(string) $element['font']], '', true, true);
                $pdf->addText($x, $pageHeight - ($offset + (float) $element['baseline']) * self::PT_PER_MM, (float) $element['size'] * self::PT_PER_MM, (string) $element['text']);

                return;

            case 'qr':
                $module = (float) $element['size'] * self::PT_PER_MM / ((int) $element['modules'] + 2 * StickerCatalogue::QUIET_ZONE_MODULES);
                $this->colour($pdf, StickerInks::rgb($artwork->mainInk()));

                foreach (StickerQrRuns::ink($artwork, $element) as [$runX, $runY, $length]) {
                    $pdf->filledRectangle($x + $runX * $module, $top - ($runY + 1) * $module, $length * $module, $module);
                }
        }
    }

    /**
     * The image as a unit square mapped by $matrix (a b c d e f): sizes and turns in fractional points, which addPngFromFile's int sizes
     * cannot carry.
     *
     * @param  array{float|int, float|int, float|int, float|int, float|int, float|int}  $matrix
     */
    private function image(Cpdf $pdf, string $file, array $matrix): void
    {
        $pdf->saveState();
        $pdf->transform($matrix);
        $pdf->addPngFromFile($file, 0, 0, 1, 1);
        $pdf->restoreState();
    }

    private function cutContour(Cpdf $pdf, StickerArtwork $artwork, float $offset, float $pageHeight): void
    {
        $pdf->saveState();
        $pdf->setStrokeColor($this->unit(StickerInks::cutContour()));
        $pdf->setLineStyle(0.25);
        $this->shapePath($pdf, $artwork, $offset, $pageHeight);
        $pdf->stroke(true);
        $pdf->restoreState();
    }

    /**
     * Two short strokes at each trim corner, outside the bleed, in registration black.
     */
    private function cropMarks(Cpdf $pdf, StickerArtwork $artwork, float $offset, float $bleed, float $pageHeight): void
    {
        $pdf->saveState();
        $pdf->setStrokeColor([0, 0, 0]);
        $pdf->setLineStyle(0.25);
        $start = $bleed + self::CROP_GAP_MM;
        $end = $start + self::CROP_MARK_MM;

        foreach ([0.0, $artwork->width] as $tx) {
            foreach ([0.0, $artwork->height] as $ty) {
                $sx = $tx === 0.0 ? -1 : 1;
                $sy = $ty === 0.0 ? -1 : 1;
                // Horizontal mark on the trim's y, vertical mark on the trim's x.
                $this->lineMm($pdf, $offset + $tx + $sx * $start, $offset + $ty, $offset + $tx + $sx * $end, $offset + $ty, $pageHeight);
                $this->lineMm($pdf, $offset + $tx, $offset + $ty + $sy * $start, $offset + $tx, $offset + $ty + $sy * $end, $pageHeight);
            }
        }

        $pdf->restoreState();
    }

    /**
     * @param  list<string>  $lines
     */
    private function slug(Cpdf $pdf, array $lines, float $offset, float $pageHeight, StickerArtwork $artwork): void
    {
        $pdf->selectFont($this->fontPaths[StickerFonts::SLUG], '', true, true);
        $this->colour($pdf, [0, 0, 0]);
        $size = self::SLUG_SIZE_PT;
        // Under the bottom crop marks, in the slug: cut off with it.
        $baseline = $pageHeight - ($offset + $artwork->height + config()->float('speedclub.stickers.bleed_mm', 3.0) + self::CROP_GAP_MM + self::CROP_MARK_MM + 2.2) * self::PT_PER_MM;

        foreach ($lines as $line) {
            $pdf->addText(self::SLUG_INSET_MM * self::PT_PER_MM, $baseline, $size, $line);
            $baseline -= $size * 1.3;
        }
    }

    /**
     * The slug lines broken at their " · " separators so each row fits the page.
     *
     * @param  list<string>  $lines
     * @return list<string>
     */
    private function rows(array $lines, float $widthPt): array
    {
        $rows = [];

        foreach ($lines as $line) {
            $row = '';

            foreach (explode(' · ', $line) as $part) {
                $candidate = $row === '' ? $part : $row.' · '.$part;

                if ($row !== '' && StickerFonts::width(StickerFonts::SLUG, $candidate) * self::SLUG_SIZE_PT > $widthPt) {
                    $rows[] = $row;
                    $row = $part;
                } else {
                    $row = $candidate;
                }
            }

            $rows[] = $row;
        }

        return $rows;
    }

    private function proof(Cpdf $pdf, StickerArtwork $artwork, float $offset, float $bottom, float $pageHeight, float $pageWidth): void
    {
        $this->colour($pdf, StickerInks::surface($artwork->colourway));
        $pdf->filledRectangle(0, 0, $pageWidth, $pageHeight);
        $this->colour($pdf, StickerInks::base($artwork->colourway, $artwork->material));
        $this->shapePath($pdf, $artwork, $offset, $pageHeight);
        $pdf->fill();
        $this->artwork($pdf, $artwork, $offset, $pageHeight, true);
        // The slug of the proof sits on the surface colour: a white strip keeps its black text readable.
        $this->colour($pdf, [255, 255, 255]);
        $pdf->filledRectangle(0, 0, $pageWidth, ($bottom - config()->float('speedclub.stickers.bleed_mm', 3.0) - self::CROP_GAP_MM - self::CROP_MARK_MM) * self::PT_PER_MM);
    }

    private function shapePath(Cpdf $pdf, StickerArtwork $artwork, float $offset, float $pageHeight): void
    {
        $k = self::PT_PER_MM;
        $x0 = $offset * $k;
        $y0 = $pageHeight - ($offset + $artwork->height) * $k;
        $w = $artwork->width * $k;
        $h = $artwork->height * $k;

        if ($artwork->shape === 'circle') {
            $this->roundedRect($pdf, $x0, $y0, $w, $h, $w / 2);

            return;
        }

        $this->roundedRect($pdf, $x0, $y0, $w, $h, $artwork->shape === 'rounded' ? min($artwork->radius * $k, $w / 2, $h / 2) : 0.0);
    }

    /**
     * A rectangle with quarter-circle corners as Bézier curves (κ = 0.5523); a radius of half the side is a circle.
     */
    private function roundedRect(Cpdf $pdf, float $x, float $y, float $w, float $h, float $r): void
    {
        $c = $r * 0.5523;
        $pdf->moveTo($x + $r, $y);
        $pdf->lineTo($x + $w - $r, $y);
        $pdf->curveTo($x + $w - $r + $c, $y, $x + $w, $y + $r - $c, $x + $w, $y + $r);
        $pdf->lineTo($x + $w, $y + $h - $r);
        $pdf->curveTo($x + $w, $y + $h - $r + $c, $x + $w - $r + $c, $y + $h, $x + $w - $r, $y + $h);
        $pdf->lineTo($x + $r, $y + $h);
        $pdf->curveTo($x + $r - $c, $y + $h, $x, $y + $h - $r + $c, $x, $y + $h - $r);
        $pdf->lineTo($x, $y + $r);
        $pdf->curveTo($x, $y + $r - $c, $x + $r - $c, $y, $x + $r, $y);
        $pdf->closePath();
    }

    private function lineMm(Cpdf $pdf, float $x1, float $y1, float $x2, float $y2, float $pageHeight): void
    {
        $k = self::PT_PER_MM;
        $pdf->line($x1 * $k, $pageHeight - $y1 * $k, $x2 * $k, $pageHeight - $y2 * $k);
    }

    /**
     * @param  array{int, int, int}  $rgb
     */
    private function colour(Cpdf $pdf, array $rgb): void
    {
        $pdf->setColor($this->unit($rgb));
    }

    /**
     * @param  array{int, int, int}  $rgb
     * @return array{float, float, float}
     */
    private function unit(array $rgb): array
    {
        return [$rgb[0] / 255, $rgb[1] / 255, $rgb[2] / 255];
    }

    /**
     * Cpdf writes only a /MediaBox. A printer's preflight reads /TrimBox (the sticker) and /BleedBox (the bleed) of each page, which are
     * not inherited: they are written into every page object, and the cross-reference table moves each later object by what was
     * inserted before it, so the file stays valid.
     */
    public static function withPrintBoxes(string $pdf, StickerArtwork $artwork, float $offset, float $bottom, float $bleed): string
    {
        $k = self::PT_PER_MM;
        $trim = sprintf('[%.3F %.3F %.3F %.3F]', $offset * $k, $bottom * $k, ($offset + $artwork->width) * $k, ($bottom + $artwork->height) * $k);
        $bleedBox = sprintf('[%.3F %.3F %.3F %.3F]', ($offset - $bleed) * $k, ($bottom - $bleed) * $k, ($offset + $artwork->width + $bleed) * $k, ($bottom + $artwork->height + $bleed) * $k);
        $insert = "\n/TrimBox ".$trim."\n/BleedBox ".$bleedBox;

        if (preg_match('/\nxref\n0 (\d+)\n/', $pdf, $xref, PREG_OFFSET_CAPTURE) !== 1) {
            throw new RuntimeException('The sticker PDF has no cross-reference table.');
        }

        $xrefAt = (int) $xref[0][1] + 1;
        $count = (int) $xref[1][0];
        $tableStart = $xrefAt + strlen("xref\n0 $count\n");
        $entries = [];

        for ($i = 0; $i < $count; $i++) {
            $entries[] = substr($pdf, $tableStart + 20 * $i, 20);
        }

        $positions = [];
        preg_match_all('/<< \/Type \/Page\n\/MediaBox \[[^\]]*\]/', substr($pdf, 0, $xrefAt), $pages, PREG_OFFSET_CAPTURE);

        foreach ($pages[0] as [$match, $at]) {
            $positions[] = $at + strlen($match);
        }

        if ($positions === []) {
            throw new RuntimeException('The sticker PDF has no page with a media box.');
        }

        $shift = fn (int $offsetInFile): int => $offsetInFile + strlen($insert) * count(array_filter($positions, fn (int $p): bool => $p < $offsetInFile));
        $body = substr($pdf, 0, $xrefAt);

        foreach (array_reverse($positions) as $position) {
            $body = substr($body, 0, $position).$insert.substr($body, $position);
        }

        $table = '';

        foreach ($entries as $entry) {
            if (preg_match('/^(\d{10}) (\d{5}) n/', $entry, $parts) === 1) {
                $table .= sprintf('%010d %s n %s', $shift((int) $parts[1]), $parts[2], "\n");
            } else {
                $table .= $entry;
            }
        }

        $rest = substr($pdf, $tableStart + 20 * $count);
        $rest = (string) preg_replace_callback('/startxref\n(\d+)/', fn (array $m): string => 'startxref'."\n".strlen($body), $rest);

        return $body."xref\n0 $count\n".$table.$rest;
    }
}
