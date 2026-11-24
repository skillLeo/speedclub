<?php

namespace App\Services\Stickers;

use App\Enums\StickerColourway;
use App\Enums\StickerMaterial;

/**
 * One sticker as geometry in millimetres, origin at the top left of the trim, y down, before mirroring (m5.4-contract §6). Every writer
 * (SVG, PDF, GD raster) draws exactly this list, so the print file, the preview and the Scan-Test raster cannot drift apart.
 *
 * Elements:
 * - logo: x, y, w, h (the box on the sticker), rotate 0|90 (90 = turned clockwise, reading top to bottom; the image is then h wide)
 * - text: font (resources/fonts file), size (mm per em), x (left end of the baseline), baseline, text, ink, line (which option)
 * - bar: x, y, w, h, ink (the Signal-Red accent)
 * - qr: x, y, size (the block, quiet zone included), modules, matrix (bool rows, no quiet zone)
 *
 * @phpstan-type Element array{kind: string, x: float, y?: float, w?: float, h?: float, rotate?: int, font?: string, size?: float, baseline?: float, text?: string, ink?: string, line?: string, modules?: int, matrix?: list<list<bool>>}
 */
final readonly class StickerArtwork
{
    /**
     * @param  list<Element>  $elements
     * @param  list<string>  $droppedLines  lines switched on that do not fit legibly (smaller than the minimum print size)
     */
    public function __construct(
        public float $width,
        public float $height,
        public string $shape,
        public float $radius,
        public StickerColourway $colourway,
        public StickerMaterial $material,
        public bool $mirrored,
        public array $elements,
        public array $droppedLines = [],
    ) {}

    /**
     * @return Element|null
     */
    public function qr(): ?array
    {
        foreach ($this->elements as $element) {
            if ($element['kind'] === 'qr') {
                return $element;
            }
        }

        return null;
    }

    /**
     * The printed symbol without its quiet zone, in mm.
     */
    public function qrSymbolMm(): ?float
    {
        $qr = $this->qr();

        return $qr === null ? null : ($qr['size'] ?? 0.0) * ($qr['modules'] ?? 0) / (($qr['modules'] ?? 0) + 2 * StickerCatalogue::QUIET_ZONE_MODULES);
    }

    /**
     * The ink of logo, text and QR field: white or black.
     */
    public function mainInk(): string
    {
        return $this->colourway->isWhiteInk() ? StickerInks::WHITE : StickerInks::BLACK;
    }
}
