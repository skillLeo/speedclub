<?php

namespace App\Services\Brand;

use RuntimeException;

/**
 * The pre-validated accent sets of design/tokens/tokens.json (`accentPalette`, 03_DESIGN_SYSTEM §3, ADM-28): the only accents the
 * admin may choose, no free colour. Read from resources/js/shared/tokens.generated.ts, which build-tokens.mjs writes after its contrast
 * gate passed and which ships with web/ (design/ does not reach the host). `default` is the palette's default set.
 */
final class AccentSets
{
    public const DEFAULT_ALIAS = 'default';

    /** @var array<string, array{label: string, dark: array<string, string>, light: array<string, string>}>|null */
    private static ?array $sets = null;

    /**
     * @return array<string, array{label: string, dark: array<string, string>, light: array<string, string>}>
     */
    public function all(): array
    {
        return self::$sets ??= $this->read();
    }

    /**
     * @return list<string>
     */
    public function keys(): array
    {
        return array_keys($this->all());
    }

    public function defaultKey(): string
    {
        $configured = config()->string('speedclub.brand.default_accent');

        return isset($this->all()[$configured]) ? $configured : $this->keys()[0];
    }

    /** A set key, `default`, or null when $value is neither. */
    public function resolve(mixed $value): ?string
    {
        if ($value === self::DEFAULT_ALIAS) {
            return $this->defaultKey();
        }

        return is_string($value) && isset($this->all()[$value]) ? $value : null;
    }

    /**
     * @return array<string, array{label: string, dark: array<string, string>, light: array<string, string>}>
     */
    private function read(): array
    {
        $path = config()->string('speedclub.brand.accent_source');
        $source = is_file($path) ? (string) file_get_contents($path) : '';

        if (preg_match('/export const accentPalette = (\{.*?\n\}) as const;/s', $source, $match) !== 1) {
            throw new RuntimeException('The accent palette is missing from the generated tokens.');
        }

        /** @var array<string, array{label: string, dark: array<string, string>, light: array<string, string>}> $sets */
        $sets = json_decode($match[1], true, 8, JSON_THROW_ON_ERROR);

        return $sets;
    }
}
