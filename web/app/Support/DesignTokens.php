<?php

namespace App\Support;

use RuntimeException;

/**
 * Colour tokens for what PHP draws or prints outside a stylesheet: the GD share cards, theme-color and the web manifest. Read from
 * resources/css/tokens.generated.css, which design/scripts/build-tokens.mjs writes from design/tokens/tokens.json after its contrast
 * gate, so PHP never holds a colour of its own (03_DESIGN_SYSTEM §2) and the deployed web/ folder carries the values with it.
 */
final class DesignTokens
{
    /** @var array<string, array<string, string>>|null theme => token => value */
    private static ?array $themes = null;

    /**
     * "#0B0B0C" for color('bg-canvas'); the token's name without the --sc-color- prefix.
     */
    public static function color(string $token, string $theme = 'carbon'): string
    {
        return self::themes()[$theme][$token] ?? throw new RuntimeException("Unknown colour token [$token] in theme [$theme].");
    }

    /**
     * [r, g, b, alpha 0..1] for GD. Takes "#RRGGBB" and "rgba(r,g,b,a)".
     *
     * @return array{int<0, 255>, int<0, 255>, int<0, 255>, float}
     */
    public static function rgba(string $token, string $theme = 'carbon'): array
    {
        $value = self::color($token, $theme);

        if (preg_match('/^#([0-9A-Fa-f]{2})([0-9A-Fa-f]{2})([0-9A-Fa-f]{2})$/', $value, $hex) === 1) {
            return [self::channel(hexdec($hex[1])), self::channel(hexdec($hex[2])), self::channel(hexdec($hex[3])), 1.0];
        }

        if (preg_match('/^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/', $value, $rgba) === 1) {
            return [self::channel($rgba[1]), self::channel($rgba[2]), self::channel($rgba[3]), isset($rgba[4]) ? (float) $rgba[4] : 1.0];
        }

        throw new RuntimeException("Colour token [$token] is no colour GD can draw: $value");
    }

    /**
     * @return int<0, 255>
     */
    private static function channel(int|float|string $value): int
    {
        return max(0, min(255, (int) $value));
    }

    /**
     * @return array<string, array<string, string>>
     */
    private static function themes(): array
    {
        if (self::$themes !== null) {
            return self::$themes;
        }

        $css = @file_get_contents(resource_path('css/tokens.generated.css'));

        if ($css === false) {
            throw new RuntimeException('resources/css/tokens.generated.css is missing: run node design/scripts/build-tokens.mjs.');
        }

        $themes = [];

        // One block per theme: ":root, [data-theme="carbon"] { … }"; the system theme's media blocks repeat a theme and are skipped.
        preg_match_all('/\[data-theme="(carbon|black|light)"\]\s*\{([^}]*)\}/', $css, $blocks, PREG_SET_ORDER);

        foreach ($blocks as [, $theme, $body]) {
            if (isset($themes[$theme])) {
                continue;
            }

            preg_match_all('/--sc-color-([a-z0-9-]+):\s*([^;]+);/', $body, $tokens, PREG_SET_ORDER);

            foreach ($tokens as [, $name, $value]) {
                $themes[$theme][$name] = trim($value);
            }
        }

        return self::$themes = $themes;
    }
}
