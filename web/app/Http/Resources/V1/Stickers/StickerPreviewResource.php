<?php

namespace App\Http\Resources\V1\Stickers;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * The live preview of STK-05: the unsaved state as SVG (millimetre viewBox, logo linked, on its surface), with its size and code size,
 * what the template prints and the warnings. The app shows it and decodes its own bitmap of it for the instant "Scan-Test bestanden".
 *
 * @property array{svg: string, size_mm: array{width: float, height: float}, qr_mm: float|null, effective: array{username: bool, car_name: bool, custom_line: bool}, warnings: list<string>} $resource
 */
class StickerPreviewResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'svg' => $this->resource['svg'],
            /** @var array{width: float, height: float} */
            'size_mm' => $this->resource['size_mm'],
            /** @var float|null */
            'qr_mm' => $this->resource['qr_mm'],
            /** @var array{username: bool, car_name: bool, custom_line: bool} */
            'effective' => $this->resource['effective'],
            /**
             * `qr_off`, `no_active_code`, and `username_too_long` / `car_name_too_long` / `custom_line_too_long` for a line left out because
             * it would print smaller than 1.8 mm at this size.
             *
             * @var list<'qr_off'|'no_active_code'|'username_too_long'|'car_name_too_long'|'custom_line_too_long'>
             */
            'warnings' => $this->resource['warnings'],
        ];
    }
}
