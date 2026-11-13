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
     * An absolute address for machines that read it out of context (og:url, og:image, canonical, the /c redirect): HTTPS whenever the
     * site is, also behind a proxy that hands PHP a plain HTTP request, so a crawler never meets a second redirect or mixed content.
     */
    public static function absolute(string $path): string
    {
        return self::secure(url($path));
    }

    /**
     * An absolute URL of this site on HTTPS whenever app.url is. Other hosts and relative paths stay as they are.
     */
    public static function secure(string $url): string
    {
        return str_starts_with(config()->string('app.url'), 'https://') && str_starts_with($url, 'http://') ? 'https://'.substr($url, 7) : $url;
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
