<?php

namespace App\Support;

use Illuminate\Support\HtmlString;

/**
 * The inline icon sprites of the public pages carry only the symbols the page uses (M4.18 LCP). The generated sprites
 * (components/icons/phosphor-sprite, components/icons/auto-sprite) hold every glyph, about 38 KB of HTML, 9–10 KB gzipped, while a page
 * shows two to six of them; the document is on the critical path of the first paint. x-public.icon, the only place that references a
 * symbol, records its id on the request; the layout prints the sprite after the page body has rendered (a component's slot renders
 * before its layout), so every id is known by then.
 */
final class PublicIcons
{
    private const KEY = 'speedclub.public_icons';

    public static function use(string $id): void
    {
        $request = request();
        /** @var array<string, true> $used */
        $used = $request->attributes->get(self::KEY, []);
        $used[$id] = true;
        $request->attributes->set(self::KEY, $used);
    }

    /**
     * The sprite's markup without the symbols this request did not use; an empty string when it used none of them.
     *
     * @param  view-string  $view
     */
    public static function sprite(string $view): HtmlString
    {
        /** @var array<string, true> $used */
        $used = request()->attributes->get(self::KEY, []);
        $kept = 0;
        $html = (string) preg_replace_callback('~\s*<symbol id="([^"]+)".*?</symbol>~s', function (array $symbol) use ($used, &$kept): string {
            if (isset($used[$symbol[1]])) {
                $kept++;

                return $symbol[0];
            }

            return '';
        }, view($view)->render());

        // A static sprite from our own Blade view, filtered to the symbols in use: safe markup, printed escaped-by-contract.
        return new HtmlString($kept === 0 ? '' : $html);
    }
}
