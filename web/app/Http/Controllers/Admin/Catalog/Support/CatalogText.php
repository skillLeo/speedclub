<?php

namespace App\Http\Controllers\Admin\Catalog\Support;

use App\Services\Catalog\CatalogRefused;

/**
 * The catalogue's admin strings on the server (lang/admin/<locale>/catalog.json, ADR-213): a refusal is answered as a field error in
 * words, so a drawer shows it next to the field it is about and a dialog shows it above its buttons. One source for the words: the
 * page translates the same keys with laravel-vue-i18n.
 */
final class CatalogText
{
    /** @var array<string, array<string, mixed>> */
    private static array $files = [];

    /**
     * @param  array<string, int|string>  $replace  `:name` placeholders
     */
    public static function get(string $path, array $replace = [], ?int $count = null): string
    {
        $locale = app()->getLocale() === 'en' ? 'en' : 'de';
        $value = data_get(self::file($locale), $path);

        if (! is_string($value)) {
            return $path;
        }

        if (str_contains($value, '|')) {
            // The plural forms laravel-vue-i18n reads on the page ("{1} 1 Mod|[2,*] :count Mods"), so one string serves both sides.
            $value = trans_choice($value, $count ?? 0, [], $locale);
        }

        foreach ($replace as $key => $text) {
            $value = str_replace(':'.$key, (string) $text, $value);
        }

        return $value;
    }

    /** The sentence for a refusal, with its count and, for `referenced`, what still points at the entry. */
    public static function refusal(CatalogRefused $refused): string
    {
        $text = self::get('refused.'.$refused->reason, ['count' => number_format($refused->count, 0, ',', '.')], $refused->count);

        if ($refused->reason === 'referenced') {
            $parts = [];

            foreach (['vehicles', 'modifications', 'aliases', 'collections'] as $kind) {
                $count = (int) ($refused->context[$kind] ?? 0);

                if ($count > 0) {
                    $parts[] = self::get('references.'.$kind, ['count' => number_format($count, 0, ',', '.')]);
                }
            }

            $text .= $parts === [] ? '' : ' ('.implode(' · ', $parts).')';
        }

        return $text;
    }

    /** The form field a refusal belongs to (the page shows it there), else `refused` (the dialog's error line). */
    public static function field(CatalogRefused $refused): string
    {
        return match ($refused->reason) {
            'slug_taken', 'slug_locked' => 'slug',
            'field_key_locked', 'category_key_locked' => 'key',
            'field_type_locked' => 'type',
            default => 'refused',
        };
    }

    /**
     * @return array<string, mixed>
     */
    private static function file(string $locale): array
    {
        if (! isset(self::$files[$locale])) {
            $path = lang_path("admin/$locale/catalog.json");
            $decoded = is_file($path) ? json_decode((string) file_get_contents($path), true) : null;
            self::$files[$locale] = is_array($decoded) ? $decoded : [];
        }

        return self::$files[$locale];
    }
}
