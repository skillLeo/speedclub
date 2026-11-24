<?php

namespace App\Http\Resources\V1\Stickers;

use App\Enums\QrStatus;
use App\Enums\StickerScanTest;
use App\Enums\StickerTemplate;
use App\Models\StickerDesign;
use App\Models\Vehicle;
use App\Services\Qr\QrCodes;
use App\Services\Stickers\StickerCatalogue;
use App\Services\Stickers\StickerFiles;
use App\Services\Stickers\StickerQrMatrix;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * One version of a vehicle's sticker design for STK-05/07, or the unsaved default before the first save (`persisted: false`, `id`
 * null, `version` 0). Owner only. The resource needs the design's vehicle loaded (`vehicle`).
 *
 * @property StickerDesign $resource
 */
class StickerDesignResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $design = $this->resource;
        /** @var Vehicle $vehicle */
        $vehicle = $design->vehicle;
        $options = $design->stickerOptions();
        $size = StickerCatalogue::size($design->template, $options->size);
        $files = app(StickerFiles::class);
        $code = $design->exists ? $files->code($design, $vehicle) : $vehicle->activeQrCode()->first();
        $persisted = $design->exists;
        $printable = $persisted && $design->isValidated() && (! $options->qr || $code?->status === QrStatus::Active);
        $warnings = [];

        if (! $options->qr) {
            $warnings[] = 'qr_off';
        } elseif ($code === null) {
            $warnings[] = 'no_active_code';
        }

        return [
            /** @var string|null */
            'id' => $persisted ? $design->id : null,
            'persisted' => $persisted,
            /**
             * The design id of the slug area, Shopify and the print partner: "SD" + 8 characters. Null before the first save.
             *
             * @var string|null
             */
            'reference' => $persisted ? $design->reference : null,
            /** 0 before the first save. */
            'version' => $persisted ? $design->version : 0,
            /**
             * Moves on every write of the design (autosave, restore, new version); send it back as `base_revision`. 0 before the first
             * save.
             */
            'revision' => $persisted ? $design->revision : 0,
            /** @var StickerTemplate */
            'template' => $design->template,
            /**
             * The member's choices, every key present.
             *
             * @var array{size: 's'|'m'|'l', colourway: 'white'|'black'|'white_red', material: 'transparent'|'white_vinyl', qr: bool, username: bool, car_name: bool, custom_line: string|null, mirrored: bool}
             */
            'options' => $options->toArray(),
            /**
             * What this template prints of the text options (a template ignores what it does not show; the choice is kept).
             *
             * @var array{username: bool, car_name: bool, custom_line: bool}
             */
            'effective' => $options->effective(),
            /** @var array{width: float, height: float} */
            'size_mm' => $size,
            /**
             * The printed code without its quiet zone, in mm (≥ 25); null without a code.
             *
             * @var float|null
             */
            'qr_mm' => $code === null || ! $options->qr ? null : StickerCatalogue::qrSymbolMm($options->size, count(StickerQrMatrix::of(app(QrCodes::class)->payload($code)))),
            /** @var 'draft'|'validated' */
            'state' => $persisted && $design->isValidated() ? 'validated' : 'draft',
            /**
             * The server's Scan-Test: null until it ran on this version.
             *
             * @var StickerScanTest|null
             */
            'scan_test' => $design->scan_test,
            /** @var string|null */
            'validated_at' => $design->validated_at?->toIso8601String(),
            /** @var string|null */
            'order_requested_at' => $design->order_requested_at?->toIso8601String(),
            /**
             * The code it was validated with, or for a draft the car's active code; null with QR off or without a code.
             *
             * @var array{display_code: string, active: bool}|null
             */
            'code' => $code === null || ! $options->qr ? null : ['display_code' => app(QrCodes::class)->displayCode($code->code), 'active' => $code->status === QrStatus::Active],
            /**
             * `qr_off`: "Ohne QR-Code kann niemand deinen Build scannen."; `no_active_code`: the car has no active code (staff took it down).
             *
             * @var list<'qr_off'|'no_active_code'>
             */
            'warnings' => $warnings,
            /**
             * Owner downloads; print files only for a validated version whose code still works.
             *
             * @var array{preview_svg: string|null, share_png: string|null, print_svg: string|null, print_pdf: string|null, print_png: string|null}
             */
            'urls' => [
                'preview_svg' => $persisted ? route('api.v1.sticker-designs.preview', ['design' => $design->id]) : null,
                'share_png' => $persisted ? route('api.v1.sticker-designs.share', ['design' => $design->id]) : null,
                'print_svg' => $printable ? route('api.v1.sticker-designs.print-svg', ['design' => $design->id]) : null,
                'print_pdf' => $printable ? route('api.v1.sticker-designs.print-pdf', ['design' => $design->id]) : null,
                'print_png' => $printable ? route('api.v1.sticker-designs.print-png', ['design' => $design->id]) : null,
            ],
            /** @var string|null */
            'created_at' => $design->created_at?->toIso8601String(),
            /** @var string|null */
            'updated_at' => $design->updated_at?->toIso8601String(),
        ];
    }
}
