<?php

namespace App\Services\PublicPages;

use kornrunner\Blurhash\Blurhash;
use Throwable;

/**
 * What x-public.photo needs beyond the API's media shape. The CSP has no 'unsafe-inline', so placeholder and focal point cannot be style
 * attributes: they become one rule per photo in the page's nonced style block.
 */
final class PublicPhoto
{
    private const PLACEHOLDER_WIDTH = 8;

    private const PLACEHOLDER_HEIGHT = 6;

    /**
     * Landing and state pages: a processed photo of the brand layer, in the shape of MediaResource. Built by scripts/build-public-assets.mjs.
     *
     * @return array<string, mixed>
     */
    public static function brand(string $key): array
    {
        /** @var array<string, array{id: string, width: int, height: int, focal_x: float, focal_y: float, alt: array<string, string>, placeholder: string, variants: list<array{width: int, height: int, path: string}>}> $photos */
        $photos = require resource_path('data/brand-photos.php');
        $photo = $photos[$key];

        return [
            ...$photo,
            'alt' => $photo['alt'][app()->getLocale()] ?? $photo['alt']['de'],
            'variants' => array_map(fn (array $variant): array => [...$variant, 'url' => url($variant['path'])], $photo['variants']),
        ];
    }

    /**
     * A blurhash as a tiny PNG the browser blurs by scaling it up. Null for anything unreadable: the surface colour shows instead.
     */
    public static function placeholder(mixed $blurhash): ?string
    {
        if (! is_string($blurhash) || $blurhash === '') {
            return null;
        }

        try {
            $pixels = Blurhash::decode($blurhash, self::PLACEHOLDER_WIDTH, self::PLACEHOLDER_HEIGHT);
            $image = imagecreatetruecolor(self::PLACEHOLDER_WIDTH, self::PLACEHOLDER_HEIGHT);

            if ($image === false) {
                return null;
            }

            foreach ($pixels as $y => $row) {
                foreach ($row as $x => [$red, $green, $blue]) {
                    imagesetpixel($image, $x, $y, (int) imagecolorallocate($image, max(0, min(255, $red)), max(0, min(255, $green)), max(0, min(255, $blue))));
                }
            }

            ob_start();
            imagepng($image, null, 9);

            return 'data:image/png;base64,'.base64_encode((string) ob_get_clean());
        } catch (Throwable) {
            return null;
        }
    }

    /**
     * The rule for one photo. Only numbers and base64 go in, so it is safe inside a style element without further escaping.
     *
     * @param  array<string, mixed>  $photo
     */
    public static function css(array $photo, string $class): string
    {
        $placeholder = is_string($photo['placeholder'] ?? null) ? $photo['placeholder'] : self::placeholder($photo['blurhash'] ?? null);
        $rules = [];

        if ($placeholder !== null && preg_match('~^data:image/(png|webp);base64,[A-Za-z0-9+/=]+$~', $placeholder) === 1) {
            $rules[] = 'background-image:url('.$placeholder.')';
        }

        if (is_numeric($photo['focal_x'] ?? null)) {
            $rules[] = 'object-position:'.round((float) $photo['focal_x'] * 100).'% '.round((is_numeric($photo['focal_y'] ?? null) ? (float) $photo['focal_y'] : 0.5) * 100).'%';
        }

        return $rules === [] ? '' : '.'.$class.'{'.implode(';', $rules).'}';
    }

    /**
     * @param  array<string, mixed>  $photo
     */
    public static function className(array $photo): string
    {
        return 'sc-ph-'.preg_replace('/[^a-z0-9-]/', '', strtolower(is_string($photo['id'] ?? null) ? $photo['id'] : ''));
    }
}
