<?php

namespace App\Http\Controllers\Admin\Config\Support;

use App\Services\Config\ConfigRefused;

/**
 * The M3.5 admin strings on the server (lang/admin/<locale>/<module>.json, ADR-213): a ConfigRefused is answered in words from
 * `config.refused.<reason>`, the same keys the pages translate with laravel-vue-i18n, so one file holds the sentence for both sides.
 */
final class AdminText
{
    /** @var array<string, array<string, mixed>> */
    private static array $files = [];

    /**
     * @param  array<string, int|string|null>  $replace  `:name` placeholders
     */
    public static function get(string $key, array $replace = []): string
    {
        [$module, $path] = array_pad(explode('.', $key, 2), 2, '');
        $locale = app()->getLocale() === 'en' ? 'en' : 'de';
        $value = data_get(self::file($locale, $module), $path);

        if (! is_string($value)) {
            return $key;
        }

        foreach ($replace as $name => $text) {
            $value = str_replace(':'.$name, (string) $text, $value);
        }

        return $value;
    }

    /** The sentence for a refusal (`config.refused.<reason>`), with the context it names (another staff member, a version). */
    public static function refusal(ConfigRefused $refused): string
    {
        $context = array_map(fn (mixed $value): string => $value === null ? '–' : (string) $value, $refused->context);

        return self::get('config.refused.'.$refused->reason, $context);
    }

    /**
     * @return array<string, mixed>
     */
    private static function file(string $locale, string $module): array
    {
        $cache = "$locale/$module";

        if (! isset(self::$files[$cache])) {
            $path = lang_path("admin/$locale/$module.json");
            $decoded = is_file($path) && preg_match('/\A[a-z_]+\z/', $module) === 1 ? json_decode((string) file_get_contents($path), true) : null;
            self::$files[$cache] = is_array($decoded) ? $decoded : [];
        }

        return self::$files[$cache];
    }
}
