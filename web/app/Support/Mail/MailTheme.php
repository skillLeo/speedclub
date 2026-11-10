<?php

namespace App\Support\Mail;

/**
 * Mail clients cannot read CSS variables, so templates get the light theme's values from the generated tokens file, which
 * stays the only place for colours and fonts (design/tokens/tokens.json).
 */
final class MailTheme
{
    private const PATH = 'css/tokens.generated.css';

    /**
     * @return array{canvas: string, surface: string, border: string, text: string, secondary: string, tertiary: string, accent: string, on_accent: string, font: string}
     */
    public static function values(): array
    {
        $css = (string) @file_get_contents(resource_path(self::PATH));
        $start = strpos($css, '[data-theme="light"]');
        $light = $start === false ? '' : substr($css, $start, (int) strpos($css, '}', $start) - $start);

        return [
            'canvas' => self::token($light, 'color-bg-canvas', 'white'),
            'surface' => self::token($light, 'color-bg-surface', 'white'),
            'border' => self::token($light, 'color-border-subtle', 'silver'),
            'text' => self::token($light, 'color-text-primary', 'black'),
            'secondary' => self::token($light, 'color-text-secondary', 'dimgray'),
            'tertiary' => self::token($light, 'color-text-tertiary', 'dimgray'),
            'accent' => self::token($light, 'color-accent-fill', 'black'),
            'on_accent' => self::token($light, 'color-text-on-accent', 'white'),
            'font' => self::token($css, 'font-ui', 'sans-serif'),
        ];
    }

    private static function token(string $css, string $name, string $fallback): string
    {
        return preg_match('/--sc-'.$name.':\s*([^;]+);/', $css, $match) === 1 ? trim($match[1]) : $fallback;
    }
}
