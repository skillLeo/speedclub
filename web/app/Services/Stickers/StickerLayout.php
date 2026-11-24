<?php

namespace App\Services\Stickers;

use App\Enums\StickerColourway;
use App\Enums\StickerTemplate;
use App\Support\BrandFiles;
use RuntimeException;

/**
 * Lays out the six templates of 10 §2.3 (m5.4-contract §2) in S millimetres and scales the result to the chosen size. The logo is the
 * client's file as delivered, pure white or pure black, whole (wordmark with its katakana line), turned only on Vertical JDM. Its
 * clear space is at least the katakana line, about an eighth of its height. Text shrinks to fit its line and never wraps.
 *
 * @phpstan-import-type Element from StickerArtwork
 */
final class StickerLayout
{
    /**
     * Width over height of the wide logo, read from public/brand/logo-wide-*-1280.png: the client's logo changed in round 3 (2026-11-19)
     * and a fixed ratio drew the new, wider one squashed.
     */
    private static function logoRatio(): float
    {
        return BrandFiles::wideRatio();
    }

    /** Never smaller than this on a print, in mm per em at the final size: below it a line is dropped rather than printed unreadably. */
    private const MIN_TEXT_MM = 1.8;

    /**
     * @var list<array{kind: string, w: float, h: float, gapAfter: float, font?: string, size?: float, text?: string, ink?: string, line?: string, matrix?: list<list<bool>>}>
     */
    private array $stack = [];

    public function build(StickerOptions $options, StickerContent $content): StickerArtwork
    {
        $template = $options->template;
        $base = StickerCatalogue::baseSize($template);
        $effective = $options->effective();
        $lines = [
            'username' => $effective['username'] && $content->username !== null ? '@'.$content->username : null,
            'car_name' => $effective['car_name'] ? $content->carName : null,
            'custom_line' => $effective['custom_line'] ? $content->customLine : null,
        ];
        $qr = $options->qr && $content->payload !== null ? StickerQrMatrix::of($content->payload) : null;
        $accent = $options->colourway === StickerColourway::WhiteRed;
        $ink = $options->colourway->isWhiteInk() ? StickerInks::WHITE : StickerInks::BLACK;

        $elements = match ($template) {
            StickerTemplate::Classic => $this->classic($base, $lines, $qr, $accent, $ink),
            StickerTemplate::Minimal => $this->minimal($base, $lines, $qr, $accent, $ink),
            StickerTemplate::Banner => $this->banner($base, $lines, $qr, $accent, $ink),
            StickerTemplate::Plate => $this->plate($base, $lines, $qr, $accent, $ink),
            StickerTemplate::VerticalJdm => $this->vertical($base, $lines, $qr, $accent, $ink),
            StickerTemplate::Round => $this->round($base, $lines, $qr, $accent, $ink),
        };

        $scale = $options->size->scale();
        $size = StickerCatalogue::size($template, $options->size);
        $elements = array_values(array_filter(array_map(fn (array $element): ?array => $this->scaled($element, $scale), $elements)));
        $printed = array_column(array_filter($elements, fn (array $e): bool => $e['kind'] === 'text'), 'line');
        $artwork = new StickerArtwork(
            width: $size['width'],
            height: $size['height'],
            shape: StickerCatalogue::shape($template),
            radius: StickerCatalogue::radius($template) * $scale,
            colourway: $options->colourway,
            material: $options->material,
            mirrored: $options->mirrored,
            elements: $elements,
            droppedLines: array_values(array_diff(array_keys(array_filter($lines, fn (?string $l): bool => $l !== null && $l !== '')), $printed)),
        );

        $this->guard($artwork);

        return $artwork;
    }

    /**
     * Logo and lines on the left, the code on the right; without the code the column is centred.
     *
     * @param  array{width: float, height: float}  $base
     * @param  array<string, string|null>  $lines
     * @param  list<list<bool>>|null  $qr
     * @return list<Element>
     */
    private function classic(array $base, array $lines, ?array $qr, bool $accent, string $ink): array
    {
        $margin = 4.0;
        $elements = [];
        $right = $base['width'] - $margin - 1.5;

        if ($qr !== null) {
            $x = $base['width'] - $margin - StickerCatalogue::QR_BLOCK_MM;
            $elements[] = $this->qr($x, ($base['height'] - StickerCatalogue::QR_BLOCK_MM) / 2, StickerCatalogue::QR_BLOCK_MM, $qr);
            $right = $x - 4.0;
        }

        $left = $margin + 1.5;
        $width = $right - $left;
        $this->stack = [];
        $this->logo(min($width, 66.0), 2.2);
        $this->bar($accent, 14.0, 1.0, 2.2, $ink);
        $this->text($lines['username'], StickerFonts::USERNAME, 6.5, $width, 2.2, $ink, 'username');
        $this->text($lines['car_name'], StickerFonts::CAR_NAME, 4.2, $width, 2.2, $ink, 'car_name');
        $this->text($lines['custom_line'], StickerFonts::LINE, 3.6, $width, 2.2, $accent ? StickerInks::RED : $ink, 'custom_line');

        return [...$elements, ...$this->place($left, $right, $margin, $base['height'] - $margin, $qr === null ? 'middle' : 'start', $ink)];
    }

    /**
     * The code on top, the small wordmark and the name under it.
     *
     * @param  array{width: float, height: float}  $base
     * @param  array<string, string|null>  $lines
     * @param  list<list<bool>>|null  $qr
     * @return list<Element>
     */
    private function minimal(array $base, array $lines, ?array $qr, bool $accent, string $ink): array
    {
        $this->stack = [];

        if ($qr !== null) {
            $this->stack[] = ['kind' => 'qr', 'w' => StickerCatalogue::QR_BLOCK_MM, 'h' => StickerCatalogue::QR_BLOCK_MM, 'gapAfter' => 2.4, 'matrix' => $qr];
        }

        $width = $base['width'] - 5.0;
        $this->logo($qr === null ? $width - 2.0 : 26.0, 2.0);
        $this->bar($accent, 10.0, 0.8, 1.8, $ink);
        $this->text($lines['username'], StickerFonts::USERNAME, 3.4, $width - 2.0, 1.8, $ink, 'username');

        return $this->place(2.5, $base['width'] - 2.5, 2.5, $base['height'] - 2.5, 'middle', $ink);
    }

    /**
     * A windscreen strip: wordmark left, the lines next to it, the code at the right end when chosen.
     *
     * @param  array{width: float, height: float}  $base
     * @param  array<string, string|null>  $lines
     * @param  list<list<bool>>|null  $qr
     * @return list<Element>
     */
    private function banner(array $base, array $lines, ?array $qr, bool $accent, string $ink): array
    {
        $margin = 5.0;
        $elements = [];
        $right = $base['width'] - $margin - 3.0;

        if ($qr !== null) {
            $x = $base['width'] - $margin - StickerCatalogue::QR_BLOCK_MM;
            $elements[] = $this->qr($x, ($base['height'] - StickerCatalogue::QR_BLOCK_MM) / 2, StickerCatalogue::QR_BLOCK_MM, $qr);
            $right = $x - 10.0;
        }

        $hasLines = array_filter($lines) !== [];
        $logoHeight = 26.0;
        $logoWidth = $logoHeight * self::logoRatio();

        if (! $hasLines) {
            $this->stack = [];
            $this->logo(min($right - $margin - 3.0, $logoWidth * 1.3), 0.0);
            $this->bar($accent, 24.0, 1.2, 0.0, $ink);

            return [...$elements, ...$this->place($margin + 3.0, $right, $margin, $base['height'] - $margin, 'middle', $ink)];
        }

        $logoX = $margin + 3.0;
        $elements[] = ['kind' => 'logo', 'x' => $logoX, 'y' => ($base['height'] - $logoHeight) / 2, 'w' => $logoWidth, 'h' => $logoHeight, 'rotate' => 0, 'ink' => $ink];
        $left = $logoX + $logoWidth + 10.0;
        $width = $right - $left;
        $this->stack = [];
        $this->bar($accent, 24.0, 1.2, 2.6, $ink);
        $this->text($lines['username'], StickerFonts::USERNAME, 11.0, $width, 3.0, $ink, 'username');
        $this->text($lines['car_name'], StickerFonts::CAR_NAME, 6.5, $width, 3.0, $ink, 'car_name');
        $this->text($lines['custom_line'], StickerFonts::LINE, 5.5, $width, 3.0, $accent ? StickerInks::RED : $ink, 'custom_line');

        return [...$elements, ...$this->place($left, $right, $margin, $base['height'] - $margin, 'start', $ink)];
    }

    /**
     * Licence-plate proportions with the name large in Archivo SemiExpanded, a small wordmark above it, the code right. Nothing of a real
     * plate: no blue band, no country code, no seal fields, no plate typeface, no frame.
     *
     * @param  array{width: float, height: float}  $base
     * @param  array<string, string|null>  $lines
     * @param  list<list<bool>>|null  $qr
     * @return list<Element>
     */
    private function plate(array $base, array $lines, ?array $qr, bool $accent, string $ink): array
    {
        $margin = 5.0;
        $elements = [];
        $right = $base['width'] - $margin - 5.0;

        if ($qr !== null) {
            $x = $base['width'] - $margin - 2.0 - StickerCatalogue::QR_BLOCK_MM;
            $elements[] = $this->qr($x, ($base['height'] - StickerCatalogue::QR_BLOCK_MM) / 2, StickerCatalogue::QR_BLOCK_MM, $qr);
            $right = $x - 6.0;
        }

        $left = $margin + 5.0;
        $width = $right - $left;
        $this->stack = [];
        $this->logo($lines['username'] === null ? min($width, 110.0) : 44.0, 2.6);
        $this->text($lines['username'], StickerFonts::CAR_NAME, 15.0, $width, 2.2, $ink, 'username');
        $this->bar($accent, 18.0, 1.0, 2.0, $ink);
        $this->text($lines['custom_line'], StickerFonts::LINE, 4.5, $width, 2.0, $accent ? StickerInks::RED : $ink, 'custom_line');

        return [...$elements, ...$this->place($left, $right, $margin, $base['height'] - $margin, 'middle', $ink)];
    }

    /**
     * A column: the whole logo turned 90° (reading top to bottom), the code at its foot, the lines under it.
     *
     * @param  array{width: float, height: float}  $base
     * @param  array<string, string|null>  $lines
     * @param  list<list<bool>>|null  $qr
     * @return list<Element>
     */
    private function vertical(array $base, array $lines, ?array $qr, bool $accent, string $ink): array
    {
        $this->stack = [];
        $thickness = $qr === null ? 30.0 : 25.0;
        $this->stack[] = ['kind' => 'logo-turned', 'w' => $thickness, 'h' => $thickness * self::logoRatio(), 'gapAfter' => 5.0];

        if ($qr !== null) {
            $this->stack[] = ['kind' => 'qr', 'w' => StickerCatalogue::QR_BLOCK_MM, 'h' => StickerCatalogue::QR_BLOCK_MM, 'gapAfter' => 2.6, 'matrix' => $qr];
        }

        $width = $base['width'] - 6.0;
        $this->bar($accent, 10.0, 0.8, 1.8, $ink);
        $this->text($lines['username'], StickerFonts::USERNAME, 3.6, $width, 1.8, $ink, 'username');
        $this->text($lines['car_name'], StickerFonts::CAR_NAME, 2.8, $width, 1.8, $ink, 'car_name');

        return $this->place(2.5, $base['width'] - 2.5, 4.0, $base['height'] - 4.0, 'middle', $ink);
    }

    /**
     * A round badge: wordmark above, the code in the middle, the name below; everything inside the circle with a margin.
     *
     * @param  array{width: float, height: float}  $base
     * @param  array<string, string|null>  $lines
     * @param  list<list<bool>>|null  $qr
     * @return list<Element>
     */
    private function round(array $base, array $lines, ?array $qr, bool $accent, string $ink): array
    {
        $this->stack = [];
        $this->logo($qr === null ? 40.0 : 24.0, 1.8);

        if ($qr !== null) {
            $this->stack[] = ['kind' => 'qr', 'w' => StickerCatalogue::QR_BLOCK_MM, 'h' => StickerCatalogue::QR_BLOCK_MM, 'gapAfter' => 1.8, 'matrix' => $qr];
        }

        $this->bar($accent, 8.0, 0.8, 1.6, $ink);
        // The chord at the name's height leaves about 28 mm; 26 keeps a millimetre to the die line.
        $this->text($lines['username'], StickerFonts::USERNAME, 3.2, 26.0, 0.0, $ink, 'username');

        return $this->place(0.0, $base['width'], 3.0, $base['height'] - 3.0, 'middle', $ink);
    }

    private function logo(float $width, float $gapAfter): void
    {
        $this->stack[] = ['kind' => 'logo', 'w' => $width, 'h' => $width / self::logoRatio(), 'gapAfter' => $gapAfter];
    }

    private function bar(bool $accent, float $width, float $height, float $gapAfter, string $ink): void
    {
        if ($accent) {
            $this->stack[] = ['kind' => 'bar', 'w' => $width, 'h' => $height, 'gapAfter' => $gapAfter, 'ink' => StickerInks::RED];
        }
    }

    private function text(?string $text, string $font, float $size, float $maxWidth, float $gapAfter, string $ink, string $line): void
    {
        if ($text === null || $text === '') {
            return;
        }

        [$text, $font] = $this->printable($text, $font);

        if ($text === '') {
            return;
        }

        $width = StickerFonts::width($font, $text);
        $size = min($size, $maxWidth / max($width, 0.001));

        $this->stack[] = ['kind' => 'text', 'w' => $width * $size, 'h' => StickerFonts::capHeight($font) * $size, 'gapAfter' => $gapAfter, 'font' => $font, 'size' => $size, 'text' => $text, 'ink' => $ink, 'line' => $line];
    }

    /**
     * A line in the font the template wants, or in Inter when that one lacks a character (a car name in Greek), without what neither has.
     *
     * @return array{0: string, 1: string}
     */
    private function printable(string $text, string $font): array
    {
        if (StickerFonts::covers($font, $text)) {
            return [$text, $font];
        }

        $fallback = StickerFonts::covers(StickerFonts::LINE, $text) ? StickerFonts::LINE : $font;
        $kept = implode('', array_filter(mb_str_split($text), fn (string $c): bool => StickerFonts::covers($fallback, $c)));

        return [trim($kept), $fallback];
    }

    /**
     * Places the stack between $top and $bottom, centred vertically; shrinks the logos when it would not fit.
     *
     * @return list<Element>
     */
    private function place(float $left, float $right, float $top, float $bottom, string $align, string $ink): array
    {
        if ($this->stack === []) {
            return [];
        }

        $last = count($this->stack) - 1;
        $items = [];

        foreach ($this->stack as $index => $item) {
            $items[] = $index === $last ? [...$item, 'gapAfter' => 0.0] : $item;
        }

        $total = array_sum(array_map(fn (array $item): float => $item['h'] + $item['gapAfter'], $items));
        $available = $bottom - $top;

        if ($total > $available) {
            $logoHeight = array_sum(array_map(fn (array $item): float => in_array($item['kind'], ['logo', 'logo-turned'], true) ? $item['h'] : 0.0, $items));
            $factor = $logoHeight > 0 ? max(0.4, ($logoHeight - ($total - $available)) / $logoHeight) : 1.0;

            foreach ($items as $index => $item) {
                if (in_array($item['kind'], ['logo', 'logo-turned'], true)) {
                    $items[$index]['w'] = $item['w'] * $factor;
                    $items[$index]['h'] = $item['h'] * $factor;
                }
            }

            $total = array_sum(array_map(fn (array $item): float => $item['h'] + $item['gapAfter'], $items));
        }

        $y = $top + max(0.0, ($available - $total) / 2);
        $elements = [];

        foreach ($items as $item) {
            $width = $item['w'];
            $x = $align === 'middle' ? $left + ($right - $left - $width) / 2 : $left;

            $elements[] = match ($item['kind']) {
                'logo' => ['kind' => 'logo', 'x' => $x, 'y' => $y, 'w' => $width, 'h' => $item['h'], 'rotate' => 0, 'ink' => $ink],
                'logo-turned' => ['kind' => 'logo', 'x' => $x, 'y' => $y, 'w' => $width, 'h' => $item['h'], 'rotate' => 90, 'ink' => $ink],
                'qr' => $this->qr($x, $y, $item['h'], $item['matrix'] ?? []),
                'bar' => ['kind' => 'bar', 'x' => $x, 'y' => $y, 'w' => $width, 'h' => $item['h'], 'ink' => $item['ink'] ?? $ink],
                default => ['kind' => 'text', 'x' => $x, 'baseline' => $y + $item['h'], 'font' => $item['font'] ?? StickerFonts::LINE, 'size' => $item['size'] ?? 3.0, 'text' => $item['text'] ?? '', 'ink' => $item['ink'] ?? $ink, 'line' => $item['line'] ?? ''],
            };

            $y += $item['h'] + $item['gapAfter'];
        }

        return $elements;
    }

    /**
     * @param  list<list<bool>>  $matrix
     * @return Element
     */
    private function qr(float $x, float $y, float $size, array $matrix): array
    {
        return ['kind' => 'qr', 'x' => $x, 'y' => $y, 'size' => $size, 'modules' => count($matrix), 'matrix' => $matrix];
    }

    /**
     * @param  Element  $element
     * @return Element|null
     */
    private function scaled(array $element, float $scale): ?array
    {
        foreach (['x', 'y', 'w', 'h', 'size', 'baseline'] as $key) {
            if (isset($element[$key])) {
                $element[$key] = round($element[$key] * $scale, 4);
            }
        }

        if ($element['kind'] === 'text' && ($element['size'] ?? 0.0) < self::MIN_TEXT_MM) {
            return null;
        }

        return $element;
    }

    /**
     * The QR rules of 10 §2.3, checked on every artwork: a design that breaks one is a bug, never a print.
     */
    private function guard(StickerArtwork $artwork): void
    {
        $qr = $artwork->qr();

        if ($qr === null) {
            return;
        }

        if ($artwork->qrSymbolMm() < (float) config('speedclub.stickers.qr_min_mm', 25)) {
            throw new RuntimeException('The sticker code would print smaller than the minimum.');
        }

        $colours = StickerInks::qrColours($artwork->colourway, $artwork->material);

        if (StickerInks::contrast($colours['dark'], $colours['light']) < StickerInks::MIN_CONTRAST) {
            throw new RuntimeException('The sticker code has too little contrast for its surface.');
        }

        $block = [$qr['x'], $qr['y'] ?? 0.0, $qr['x'] + ($qr['size'] ?? 0.0), ($qr['y'] ?? 0.0) + ($qr['size'] ?? 0.0)];

        foreach ($artwork->elements as $element) {
            if ($element['kind'] === 'qr' || $element['kind'] === 'text') {
                continue;
            }

            $box = [$element['x'], $element['y'] ?? 0.0, $element['x'] + ($element['w'] ?? 0.0), ($element['y'] ?? 0.0) + ($element['h'] ?? 0.0)];

            if ($box[0] < $block[2] && $box[2] > $block[0] && $box[1] < $block[3] && $box[3] > $block[1]) {
                throw new RuntimeException('Something would be printed into the sticker code or its quiet zone.');
            }
        }
    }
}
