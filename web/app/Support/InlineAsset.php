<?php

declare(strict_types=1);

namespace App\Support;

use Illuminate\Support\Facades\Vite;
use Illuminate\Support\HtmlString;

/**
 * The built public stylesheet, for a <style> block in the page head.
 *
 * The public pages are mostly first visits from a QR scan or a shared link: a separate stylesheet costs a whole round
 * trip before the browser knows the hero photo's layout and the fonts it needs. The file is the Vite build output
 * (ours, from resources/css), read once per page by the layout. No static cache: it would outlive the request in a
 * long-running process (a test worker, for one) and keep serving a stylesheet from before a rebuild or a faked Vite.
 */
final class InlineAsset
{
    public static function css(string $entry): HtmlString
    {
        return new HtmlString(self::guard(Vite::content($entry)));
    }

    /** A stylesheet cannot end the element it is printed in. */
    private static function guard(string $css): string
    {
        return str_ireplace('</style', '<\/style', $css);
    }
}
