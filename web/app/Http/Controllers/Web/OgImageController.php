<?php

namespace App\Http\Controllers\Web;

use App\Http\Controllers\Controller;
use App\Services\PublicPages\OgImages;
use Illuminate\Http\Request;
use Illuminate\Http\Response;

/**
 * The link previews behind og:image and twitter:image (OgImages): /og/v/{slug}-{hash}.jpg, /og/u/{username}-{hash}.jpg and the brand
 * card /og/site-{hash}.jpg, each also as -square.jpg. Answers the JPEG itself, never a redirect (WhatsApp and X follow none for
 * images), without session or cookie, and draws a missing card on the spot. A current address is cached for a year as immutable; an
 * outdated one gets today's card for an hour. Anything not public is a 404.
 */
class OgImageController extends Controller
{
    public function __invoke(Request $request, OgImages $images, string $type, ?string $file = null): Response
    {
        // /og/{file} binds its one parameter first: the brand card.
        $card = $file === null ? $images->serve('site', $type) : $images->serve($type, $file);

        if ($card === null) {
            return new Response('', 404, ['Content-Type' => 'text/plain; charset=UTF-8', 'Cache-Control' => 'no-store', 'X-Robots-Tag' => 'noindex']);
        }

        $etag = '"'.$card['etag'].'"';
        $headers = [
            'Content-Type' => 'image/jpeg',
            'Cache-Control' => $card['current'] ? 'public, max-age=31536000, immutable' : 'public, max-age=3600',
            'ETag' => $etag,
            'X-Content-Type-Options' => 'nosniff',
            'Access-Control-Allow-Origin' => '*',
        ];

        if (in_array($etag, $request->getETags(), true)) {
            return new Response('', 304, $headers);
        }

        return new Response($card['bytes'], 200, [...$headers, 'Content-Length' => (string) strlen($card['bytes'])]);
    }
}
