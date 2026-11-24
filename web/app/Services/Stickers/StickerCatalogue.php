<?php

namespace App\Services\Stickers;

use App\Enums\StickerSize;
use App\Enums\StickerTemplate;

/**
 * The six templates of 10 §2.3 (m5.4-contract §2): base size (S) in millimetres, cut shape and the text options each one prints.
 * M and L scale the same layout uniformly, so a layout is drawn once in S units. Every base size leaves the QR block (code plus its
 * 4-module quiet zone) 35 mm, which keeps the printed symbol ≥ 25 mm for every QR version (21 modules: 35 × 21/29 = 25.3 mm).
 */
final class StickerCatalogue
{
    /** The QR block at S, quiet zone included. */
    public const QR_BLOCK_MM = 35.0;

    public const QUIET_ZONE_MODULES = 4;

    /** @var array<string, array{width: float, height: float, shape: string, radius: float, options: list<string>, qr_default: bool}> */
    private const TEMPLATES = [
        'classic' => ['width' => 120.0, 'height' => 50.0, 'shape' => 'rounded', 'radius' => 4.0, 'options' => ['username', 'car_name', 'custom_line'], 'qr_default' => true],
        'minimal' => ['width' => 40.0, 'height' => 60.0, 'shape' => 'rounded', 'radius' => 3.0, 'options' => ['username'], 'qr_default' => true],
        'banner' => ['width' => 300.0, 'height' => 50.0, 'shape' => 'rect', 'radius' => 0.0, 'options' => ['username', 'car_name', 'custom_line'], 'qr_default' => false],
        'plate' => ['width' => 250.0, 'height' => 50.0, 'shape' => 'rounded', 'radius' => 5.0, 'options' => ['username', 'custom_line'], 'qr_default' => true],
        'vertical_jdm' => ['width' => 40.0, 'height' => 150.0, 'shape' => 'rounded', 'radius' => 3.0, 'options' => ['username', 'car_name'], 'qr_default' => true],
        'round' => ['width' => 60.0, 'height' => 60.0, 'shape' => 'circle', 'radius' => 30.0, 'options' => ['username'], 'qr_default' => true],
    ];

    /**
     * @return array{width: float, height: float}
     */
    public static function size(StickerTemplate $template, StickerSize $size): array
    {
        $base = self::TEMPLATES[$template->value];

        return ['width' => round($base['width'] * $size->scale(), 2), 'height' => round($base['height'] * $size->scale(), 2)];
    }

    /**
     * @return array{width: float, height: float}
     */
    public static function baseSize(StickerTemplate $template): array
    {
        return ['width' => self::TEMPLATES[$template->value]['width'], 'height' => self::TEMPLATES[$template->value]['height']];
    }

    /**
     * `rounded`, `rect` or `circle`: the die line.
     */
    public static function shape(StickerTemplate $template): string
    {
        return self::TEMPLATES[$template->value]['shape'];
    }

    /**
     * Corner radius at S (the circle's radius for `round`).
     */
    public static function radius(StickerTemplate $template): float
    {
        return self::TEMPLATES[$template->value]['radius'];
    }

    /**
     * @return list<string>
     */
    public static function textOptions(StickerTemplate $template): array
    {
        return self::TEMPLATES[$template->value]['options'];
    }

    public static function qrDefault(StickerTemplate $template): bool
    {
        return self::TEMPLATES[$template->value]['qr_default'];
    }

    /**
     * The printed symbol without its quiet zone for a code of $modules modules at $size.
     */
    public static function qrSymbolMm(StickerSize $size, int $modules): float
    {
        return round(self::QR_BLOCK_MM * $size->scale() * $modules / ($modules + 2 * self::QUIET_ZONE_MODULES), 1);
    }
}
