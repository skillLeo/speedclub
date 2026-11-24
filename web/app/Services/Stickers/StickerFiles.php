<?php

namespace App\Services\Stickers;

use App\Enums\QrStatus;
use App\Models\QrCode;
use App\Models\StickerDesign;
use App\Models\Vehicle;
use App\Services\Qr\QrCodes;

/**
 * Turns a design into its files (m5.4-contract §6): the artwork for the right code, the print SVG/PDF/PNG with the code the version was
 * validated with, the share PNG with the page address (ADR-514), the on-screen preview. Print files of a draft use the car's active code.
 */
final class StickerFiles
{
    /** The long edge of the share picture. */
    public const SHARE_EDGE_PX = 1600;

    public function __construct(
        private readonly StickerLayout $layout,
        private readonly StickerContents $contents,
        private readonly StickerSvg $svg,
        private readonly StickerPdf $pdf,
        private readonly StickerRaster $raster,
        private readonly QrCodes $codes,
    ) {}

    /**
     * The code a version prints: the one it was validated with, or for a draft the car's active code (null when there is none).
     */
    public function code(StickerDesign $design, Vehicle $vehicle): ?QrCode
    {
        if ($design->isValidated()) {
            return $design->qrCode;
        }

        return $vehicle->activeQrCode()->first();
    }

    public function artwork(Vehicle $vehicle, StickerOptions $options, ?QrCode $code, bool $share = false): StickerArtwork
    {
        return $this->layout->build($options, $this->contents->for($vehicle, $options, $code, $share));
    }

    public function previewSvg(StickerDesign $design, Vehicle $vehicle): string
    {
        return $this->svg->preview($this->artwork($vehicle, $design->stickerOptions(), $this->code($design, $vehicle)), $this->title($design));
    }

    public function printSvg(StickerDesign $design, Vehicle $vehicle): string
    {
        return $this->svg->print($this->artwork($vehicle, $design->stickerOptions(), $this->code($design, $vehicle)), $this->title($design));
    }

    public function printPdf(StickerDesign $design, Vehicle $vehicle): string
    {
        $code = $this->code($design, $vehicle);
        $artwork = $this->artwork($vehicle, $design->stickerOptions(), $code);

        return $this->pdf->render($artwork, [
            'reference' => $design->reference,
            'version' => $design->version,
            'lines' => $this->slugLines($design, $artwork, $code),
            'proof' => (string) __('stickers.slug.proof', ['reference' => $design->reference], 'de'),
        ]);
    }

    /**
     * 300 dpi, transparent, inks only, mirrored when the design is.
     */
    public function printPng(StickerDesign $design, Vehicle $vehicle): string
    {
        $artwork = $this->artwork($vehicle, $design->stickerOptions(), $this->code($design, $vehicle));

        return $this->raster->png($this->raster->render($artwork, StickerRaster::PRINT_DPI / 25.4, 'print'));
    }

    /**
     * The sticker on its surface for posting: the code leads to the car's page, never the sticker code (ADR-514).
     */
    public function sharePng(StickerDesign $design, Vehicle $vehicle): string
    {
        $artwork = $this->artwork($vehicle, $design->stickerOptions(), null, share: true);
        $pxPerMm = (self::SHARE_EDGE_PX * 0.84) / max($artwork->width, $artwork->height);
        $padding = (int) round(self::SHARE_EDGE_PX * 0.08);

        return $this->raster->png($this->raster->render($artwork, $pxPerMm, 'seen', $padding));
    }

    public function title(StickerDesign $design): string
    {
        return 'Speedclub Sticker '.$design->reference.' v'.$design->version;
    }

    /**
     * The printer's notes in the slug, in German (the print partner's language): design id, version, template, size, inks, material,
     * mirrored, the code and the date; then what each ink means.
     *
     * @return list<string>
     */
    public function slugLines(StickerDesign $design, StickerArtwork $artwork, ?QrCode $code): array
    {
        $options = $design->stickerOptions();
        $parts = [
            $design->reference,
            'v'.$design->version,
            $options->template->label('de'),
            strtoupper($options->size->value).' '.$this->mm($artwork->width).' × '.$this->mm($artwork->height).' mm',
            $options->colourway->label('de'),
            $options->material->label('de'),
        ];

        if ($options->mirrored) {
            $parts[] = (string) __('stickers.slug.mirrored', [], 'de');
        }

        $parts[] = $code === null || ! $options->qr
            ? (string) __('stickers.slug.no_code', [], 'de')
            : (string) __('stickers.slug.code', ['code' => $this->codes->displayCode($code->code)], 'de').($code->status === QrStatus::Active ? '' : ' '.__('stickers.slug.code_inactive', [], 'de'));
        $parts[] = now(config()->string('speedclub.display_timezone'))->format('d.m.Y');

        return [implode(' · ', $parts), (string) __('stickers.slug.inks', [], 'de')];
    }

    private function mm(float $value): string
    {
        return rtrim(rtrim(number_format($value, 1, ',', ''), '0'), ',');
    }
}
