<?php

namespace App\Services\Stickers;

/**
 * The vector sticker (m5.4-contract §6.1, §6.5). Print: millimetre units, one group per ink, text as outlines (no font at the printer),
 * the logo embedded, the die line as a magenta hairline in `CutContour`, a mirrored design mirrored as a whole. Preview: the same
 * artwork on its surface (dark glass or light paint, the vinyl inside the die line), the logo linked instead of embedded.
 */
final class StickerSvg
{
    public function print(StickerArtwork $artwork, string $title): string
    {
        return $this->document($artwork, $title, false);
    }

    public function preview(StickerArtwork $artwork, string $title): string
    {
        return $this->document($artwork, $title, true);
    }

    private function document(StickerArtwork $artwork, string $title, bool $preview): string
    {
        $w = $this->n($artwork->width);
        $h = $this->n($artwork->height);
        $shape = $this->shapePath($artwork);
        $body = '';

        if ($preview) {
            $body .= sprintf('<rect id="surface" width="%s" height="%s" fill="%s"/>', $w, $h, $this->hex(StickerInks::surface($artwork->colourway)));
            $body .= sprintf('<path id="material" d="%s" fill="%s"/>', $shape, $this->hex(StickerInks::base($artwork->colourway, $artwork->material)));
        }

        $groups = [StickerInks::WHITE => '', StickerInks::BLACK => '', StickerInks::RED => ''];

        foreach ($artwork->elements as $element) {
            $ink = (string) ($element['ink'] ?? $artwork->mainInk());
            $groups[$ink] = ($groups[$ink] ?? '').$this->element($artwork, $element, $preview);
        }

        $art = '';

        foreach ($groups as $ink => $content) {
            if ($content !== '') {
                $art .= sprintf('<g id="ink-%s" fill="%s">%s</g>', $ink, $this->hex(StickerInks::rgb($ink)), $content);
            }
        }

        $transform = $artwork->mirrored ? sprintf(' transform="matrix(-1 0 0 1 %s 0)"', $w) : '';
        $body .= sprintf('<g id="artwork"%s>%s</g>', $transform, $art);
        // The printer's magenta die line; on screen the edge of the vinyl as a faint line in the ink.
        $body .= $preview
            ? sprintf('<path id="edge" d="%s" fill="none" stroke="%s" stroke-opacity="0.35" stroke-width="0.3"/>', $shape, $this->hex(StickerInks::rgb($artwork->mainInk())))
            : sprintf('<g id="CutContour"><path d="%s" fill="none" stroke="%s" stroke-width="0.1"/></g>', $shape, $this->hex(StickerInks::cutContour()));

        return '<?xml version="1.0" encoding="UTF-8"?>'."\n"
            .sprintf('<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="%1$smm" height="%2$smm" viewBox="0 0 %1$s %2$s">', $w, $h)
            .'<title>'.htmlspecialchars($title, ENT_XML1 | ENT_QUOTES, 'UTF-8').'</title>'
            .$body.'</svg>';
    }

    /**
     * @param  array<string, mixed>  $element
     */
    private function element(StickerArtwork $artwork, array $element, bool $preview): string
    {
        $x = (float) $element['x'];
        $y = (float) ($element['y'] ?? 0.0);

        switch ($element['kind']) {
            case 'logo':
                $ink = (string) ($element['ink'] ?? $artwork->mainInk());
                $href = $preview ? StickerLogo::url($ink) : 'data:image/png;base64,'.base64_encode(StickerLogo::png($ink));
                $w = (float) ($element['w'] ?? 0.0);
                $h = (float) ($element['h'] ?? 0.0);

                if (($element['rotate'] ?? 0) === 90) {
                    return sprintf('<image transform="translate(%s %s) rotate(90)" width="%s" height="%s" preserveAspectRatio="none" href="%s" xlink:href="%5$s"/>', $this->n($x + $w), $this->n($y), $this->n($h), $this->n($w), $href);
                }

                return sprintf('<image x="%s" y="%s" width="%s" height="%s" preserveAspectRatio="none" href="%s" xlink:href="%5$s"/>', $this->n($x), $this->n($y), $this->n($w), $this->n($h), $href);

            case 'bar':
                return sprintf('<rect x="%s" y="%s" width="%s" height="%s"/>', $this->n($x), $this->n($y), $this->n((float) ($element['w'] ?? 0.0)), $this->n((float) ($element['h'] ?? 0.0)));

            case 'text':
                return sprintf('<path d="%s"/>', StickerFonts::svgPath((string) $element['font'], (string) $element['text'], (float) $element['size'], $x, (float) $element['baseline']));

            case 'qr':
                $runs = StickerQrRuns::ink($artwork, $element);
                $module = (float) $element['size'] / ((int) $element['modules'] + 2 * StickerCatalogue::QUIET_ZONE_MODULES);
                $d = implode('', array_map(fn (array $run): string => sprintf('M%d %dh%dv1h-%dz', $run[0], $run[1], $run[2], $run[2]), $runs));

                return sprintf('<path id="qr" transform="translate(%s %s) scale(%s)" d="%s"/>', $this->n($x), $this->n($y), $this->n($module, 6), $d);
        }

        return '';
    }

    private function shapePath(StickerArtwork $artwork): string
    {
        $w = $artwork->width;
        $h = $artwork->height;

        if ($artwork->shape === 'circle') {
            $r = $w / 2;

            return sprintf('M0 %1$s a%1$s %1$s 0 1 0 %2$s 0 a%1$s %1$s 0 1 0 -%2$s 0z', $this->n($r), $this->n($w));
        }

        $r = $artwork->shape === 'rounded' ? min($artwork->radius, $w / 2, $h / 2) : 0.0;

        if ($r <= 0) {
            return sprintf('M0 0h%1$sv%2$sh-%1$sz', $this->n($w), $this->n($h));
        }

        return sprintf(
            'M%1$s 0h%2$sa%1$s %1$s 0 0 1 %1$s %1$sv%3$sa%1$s %1$s 0 0 1 -%1$s %1$sh-%2$sa%1$s %1$s 0 0 1 -%1$s -%1$sv-%3$sa%1$s %1$s 0 0 1 %1$s -%1$sz',
            $this->n($r), $this->n($w - 2 * $r), $this->n($h - 2 * $r),
        );
    }

    /**
     * @param  array{int, int, int}  $rgb
     */
    private function hex(array $rgb): string
    {
        return sprintf('#%02X%02X%02X', ...$rgb);
    }

    private function n(float $value, int $decimals = 3): string
    {
        $text = rtrim(rtrim(number_format($value, $decimals, '.', ''), '0'), '.');

        return $text === '-0' || $text === '' ? '0' : $text;
    }
}
