<?php

namespace App\Http\Middleware;

use App\Services\Config\PreviewTokens;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * ETag + If-None-Match for cacheable GETs (05_ARCHITECTURE §7). Clients always revalidate; the saving is the body.
 * The tag covers the rendered body, so each locale has its own.
 */
class ETag
{
    /**
     * @param  Closure(Request): Response  $next
     * @param  string|null  $mode  `no-store` (etag:no-store, M2.4 messaging): the answer may never be written to a browser or NSURLCache
     *                             store; a client that holds a copy in memory still gets the 304 for If-None-Match
     */
    public function handle(Request $request, Closure $next, ?string $mode = null): Response
    {
        $response = $next($request);

        if (! $request->isMethodCacheable() || $response->getStatusCode() !== 200) {
            return $response;
        }

        // ADM-34 (code review SF-2): an answer with a staff member's drafts is never stored, by a browser or a proxy: no ETag and no 304,
        // no-store, and it varies on the token header, so a browser cache never answers the plain URL with the draft.
        if (app(PreviewTokens::class)->current() !== null) {
            $response->headers->set('Cache-Control', 'private, no-store');
            $response->setVary([PreviewTokens::HEADER, 'Accept-Language'], false);
            $response->headers->remove('ETag');

            return $response;
        }

        $content = $response->getContent();

        if ($content === false) {
            return $response;
        }

        $tag = substr(hash('sha256', $content), 0, 32);

        $response->setEtag($tag);
        $response->headers->set('Cache-Control', $mode === 'no-store' ? 'private, no-store' : 'private, no-cache');
        $response->setVary('Accept-Language', false);

        if ($this->matches($request, $tag)) {
            $response->setNotModified();
        }

        return $response;
    }

    /**
     * Apache's mod_deflate turns "tag" into "tag-gzip" on the way out, and clients send that form back.
     */
    private function matches(Request $request, string $tag): bool
    {
        foreach ($request->getETags() as $candidate) {
            $normalised = preg_replace(['/^W\//', '/-(gzip|br|deflate)"$/', '/"/'], ['', '"', ''], $candidate);

            if ($normalised === $tag || $candidate === '*') {
                return true;
            }
        }

        return false;
    }
}
