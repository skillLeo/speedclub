<?php

namespace App\Services\Qr;

use chillerlan\QRCode\Data\QRMatrix;
use chillerlan\QRCode\Output\QRMarkupSVG;

/**
 * The same modules as the library's SVG, written as one white square and one path of horizontal runs of dark modules.
 * The library writes every module as its own square ("M15 4 h1 v1 h-1Z"), about 36 KB for a version-7 code; the runs are a
 * fifth of that, which matters where the code sits in a page (WEB-03). Same pixels: one path with abutting squares has no seams either.
 */
class CompactSvg extends QRMarkupSVG
{
    protected function paths(): string
    {
        $size = $this->moduleCount;
        $runs = [];

        for ($y = 0; $y < $size; $y++) {
            $x = 0;

            while ($x < $size) {
                if (! $this->matrix->isDark($this->matrix->get($x, $y))) {
                    $x++;

                    continue;
                }

                $start = $x;

                while ($x < $size && $this->matrix->isDark($this->matrix->get($x, $y))) {
                    $x++;
                }

                $length = $x - $start;
                $runs[] = "M{$start} {$y}h{$length}v1h-{$length}z";
            }
        }

        $light = sprintf('<path class="qr-light" fill="%2$s" d="M0 0h%1$dv%1$dh-%1$dz"/>', $size, $this->value(QRMatrix::M_DATA));

        if ($runs === []) {
            return $light;
        }

        // Line length stays bounded, as in the library.
        $dark = implode($this->eol, array_map(fn (array $chunk): string => implode('', $chunk), array_chunk($runs, 40)));

        return $light.$this->eol.sprintf('<path class="qr-dark" fill="%s" d="%s"/>', $this->value(QRMatrix::M_DATA_DARK), $dark);
    }

    private function value(int $type): string
    {
        $value = $this->getModuleValue($type);

        return is_string($value) ? $value : ($this->matrix->isDark($type) ? '#000' : '#fff');
    }
}
