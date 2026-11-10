<?php

namespace App\Support;

use Illuminate\Support\Str;

/**
 * Vehicle slugs: make-model-generation-publicid (02_PRODUCT_SPEC §3.2).
 *
 * Only the public_id identifies a vehicle. The text part is decoration: when it differs from the stored
 * slug, the caller answers with a 301 to the canonical URL.
 */
final class Slug
{
    /** Keeps the slug column and URLs short when free-text make and model names are long. */
    private const MAX_TEXT_LENGTH = 120;

    private const GERMAN = ['ä' => 'ae', 'ö' => 'oe', 'ü' => 'ue', 'Ä' => 'Ae', 'Ö' => 'Oe', 'Ü' => 'Ue', 'ß' => 'ss', 'ẞ' => 'Ss'];

    public static function make(string $text): string
    {
        // Str::slug deletes these instead of separating on them: "Z3/M3" must not become "z3m3".
        $text = strtr($text, ['/' => ' ', '\\' => ' ', '.' => ' ', '+' => ' ', '&' => ' ']);

        return Str::slug(strtr($text, self::GERMAN), '-', 'de', []);
    }

    public static function forVehicle(?string $make, ?string $model, ?string $generation, string $publicId): string
    {
        $parts = array_map(fn (?string $part): string => self::make((string) $part), [$make, $model, $generation]);
        $text = implode('-', array_filter($parts, fn (string $part): bool => $part !== ''));
        $text = rtrim(substr($text, 0, self::MAX_TEXT_LENGTH), '-');
        $id = strtolower($publicId);

        return $text === '' ? $id : "$text-$id";
    }

    /**
     * The public_id in a URL slug (uppercase, as stored), or null when the slug does not end in one.
     */
    public static function publicId(string $slug): ?string
    {
        $position = strrpos($slug, '-');
        $id = strtoupper($position === false ? $slug : substr($slug, $position + 1));

        return Codes::isValid($id) ? $id : null;
    }
}
