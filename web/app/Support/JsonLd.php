<?php

namespace App\Support;

use Illuminate\Support\HtmlString;

/**
 * JSON-LD for a <script type="application/ld+json"> block (05_ARCHITECTURE §18). Every <, >, & and quote becomes a \u escape, so a
 * member's text can neither close the script element nor open a comment in it. The result is an HtmlString, so {{ }} prints it as
 * markup and no public view needs an unescaped echo (tests/Feature/Garage/GarageSecurityAuditTest.php).
 */
final class JsonLd
{
    /**
     * @param  array<array-key, mixed>  $block
     */
    public static function encode(array $block): HtmlString
    {
        return new HtmlString(json_encode(
            $block,
            JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT | JSON_THROW_ON_ERROR,
        ));
    }
}
