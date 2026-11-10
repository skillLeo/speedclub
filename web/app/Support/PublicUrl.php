<?php

namespace App\Support;

/**
 * A link from one public page to another. A guest has no cookie (ADR-115), so a language chosen in the footer travels in the address.
 */
final class PublicUrl
{
    public static function to(string $path): string
    {
        return url($path).self::language();
    }

    /**
     * The same page in the language picked with ?lang=, for canonical and hreflang. A page without ?lang= is its own canonical.
     */
    public static function canonical(string $canonical): string
    {
        return $canonical.self::language();
    }

    private static function language(): string
    {
        $language = request()->query('lang');

        return is_string($language) && in_array($language, config()->array('speedclub.locales'), true) ? '?lang='.$language : '';
    }
}
