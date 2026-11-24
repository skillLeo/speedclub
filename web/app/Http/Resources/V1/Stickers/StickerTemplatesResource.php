<?php

namespace App\Http\Resources\V1\Stickers;

use App\Enums\StickerColourway;
use App\Enums\StickerMaterial;
use App\Enums\StickerSize;
use App\Enums\StickerTemplate;
use App\Services\Stickers\StickerCatalogue;
use App\Services\Stickers\StickerOptions;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * STK-05 template catalogue (m5.4-contract §2): sizes in mm with the printed code size, the text options each template shows, the
 * colourways with the materials they allow, and the limits. Names and hints follow Accept-Language.
 *
 * @property array{modules: int} $resource the module count of this host's sticker codes
 */
class StickerTemplatesResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $modules = $this->resource['modules'];

        return [
            /**
             * @var list<array{key: StickerTemplate, name: string, description: string, shape: 'rounded'|'rect'|'circle', corner_radius_mm: float, sizes: list<array{key: StickerSize, width_mm: float, height_mm: float, qr_mm: float}>, options: list<'username'|'car_name'|'custom_line'>, defaults: array<string, mixed>}>
             */
            'templates' => array_map(fn (StickerTemplate $template): array => [
                'key' => $template,
                'name' => $template->label(),
                'description' => (string) __('stickers.templates.'.$template->value),
                'shape' => StickerCatalogue::shape($template),
                'corner_radius_mm' => StickerCatalogue::radius($template),
                'sizes' => array_map(fn (StickerSize $size): array => [
                    'key' => $size,
                    'width_mm' => StickerCatalogue::size($template, $size)['width'],
                    'height_mm' => StickerCatalogue::size($template, $size)['height'],
                    'qr_mm' => StickerCatalogue::qrSymbolMm($size, $modules),
                ], StickerSize::cases()),
                'options' => StickerCatalogue::textOptions($template),
                'defaults' => StickerOptions::defaults($template, $request->user()?->getAttribute('show_owner_on_qr') !== false)->toArray(),
            ], StickerTemplate::cases()),
            /**
             * @var list<array{key: StickerColourway, name: string, hint: string, materials: list<StickerMaterial>, mirrored_allowed: bool}>
             */
            'colourways' => array_map(fn (StickerColourway $colourway): array => [
                'key' => $colourway,
                'name' => $colourway->label(),
                'hint' => (string) __('stickers.colourway_hints.'.$colourway->value),
                'materials' => $colourway->materials(),
                'mirrored_allowed' => true,
            ], StickerColourway::cases()),
            /**
             * @var list<array{key: StickerMaterial, name: string}>
             */
            'materials' => array_map(fn (StickerMaterial $material): array => ['key' => $material, 'name' => $material->label()], StickerMaterial::cases()),
            /**
             * @var array{custom_line_max: int, qr_min_mm: int, quiet_zone_modules: int, error_correction: 'H', bleed_mm: float}
             */
            'limits' => [
                'custom_line_max' => config()->integer('speedclub.stickers.custom_line_max', 24),
                'qr_min_mm' => config()->integer('speedclub.stickers.qr_min_mm', 25),
                'quiet_zone_modules' => StickerCatalogue::QUIET_ZONE_MODULES,
                'error_correction' => 'H',
                'bleed_mm' => config()->float('speedclub.stickers.bleed_mm', 3.0),
            ],
        ];
    }
}
