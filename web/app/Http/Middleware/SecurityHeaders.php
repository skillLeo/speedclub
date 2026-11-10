<?php

namespace App\Http\Middleware;

use App\Http\Csp\ApiPreset;
use App\Http\Csp\SpaPreset;
use App\Services\Config\PreviewTokens;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Vite;
use Spatie\Csp\Policy;
use Spatie\Csp\Preset;
use Symfony\Component\HttpFoundation\Response;

/**
 * Baseline headers on everything PHP answers, plus the CSP through spatie/laravel-csp (05_ARCHITECTURE §15):
 * nonces on Blade and admin, hashes on the Expo export in /app, nothing at all on the JSON API.
 */
class SecurityHeaders
{
    /**
     * @param  Closure(Request): Response  $next
     */
    public function handle(Request $request, Closure $next): Response
    {
        Vite::useCspNonce($this->nonce());

        $response = $next($request);

        $response->headers->set('X-Content-Type-Options', 'nosniff');
        // ADM-34: a page opened with a valid staff preview token may be framed by the admin on the same origin (the draft preview frames);
        // everything else, and every page without a token, stays unframeable.
        $previewFrame = $this->previewFrame($request);
        $response->headers->set('X-Frame-Options', $previewFrame ? 'SAMEORIGIN' : 'DENY');
        $response->headers->set('Referrer-Policy', 'strict-origin-when-cross-origin');
        $response->headers->set('Permissions-Policy', 'camera=(), geolocation=(), microphone=(), payment=(), usb=()');
        $response->headers->set('Cross-Origin-Opener-Policy', 'same-origin');

        if ($request->isSecure()) {
            $response->headers->set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
        }

        $this->applyCsp($request, $response);

        // Code review SF-2: a page rendered with a staff preview token (Blade, the app shell) is never stored, and varies on the token
        // and the query that carries it.
        if ($request->isMethodCacheable() && ! $request->is('api', 'api/*', 'admin', 'admin/*') && app(PreviewTokens::class)->current() !== null) {
            $response->headers->set('Cache-Control', 'private, no-store');
            $response->headers->remove('ETag');
            $response->setVary([PreviewTokens::HEADER, 'Accept-Language'], false);
        }

        if ($previewFrame && $response->headers->has('Content-Security-Policy')) {
            $response->headers->set('Content-Security-Policy', str_replace("frame-ancestors 'none'", "frame-ancestors 'self'", (string) $response->headers->get('Content-Security-Policy')));
        }

        return $response;
    }

    private function previewFrame(Request $request): bool
    {
        if (! $request->isMethodCacheable() || ! $request->query->has(PreviewTokens::QUERY) || $request->is('api', 'api/*', 'admin', 'admin/*')) {
            return false;
        }

        return app(PreviewTokens::class)->current() !== null;
    }

    private function applyCsp(Request $request, Response $response): void
    {
        if (! config()->boolean('csp.enabled') || $response->headers->has('Content-Security-Policy')) {
            return;
        }

        // As in Spatie's own middleware: the debug page and the Vite dev server rely on inline code.
        if (config()->boolean('app.debug') && ($response->isServerError() || Vite::isRunningHot())) {
            return;
        }

        // The API docs (local and staging only) load their viewer from a CDN.
        if ($request->is('docs/api', 'docs/api/*')) {
            return;
        }

        /** @var list<class-string<Preset>> $presets */
        $presets = match (true) {
            $request->is('api', 'api/*') => [ApiPreset::class],
            $request->is('app', 'app/*') && $response->isSuccessful() => [SpaPreset::class],
            default => config('csp.presets'),
        };

        $policy = Policy::create($presets, reportUri: config()->string('csp.report_uri'));

        if (! $policy->isEmpty()) {
            $response->headers->set('Content-Security-Policy', $policy->getContents());
        }
    }

    private function nonce(): string
    {
        $nonce = app('csp-nonce');

        return is_string($nonce) ? $nonce : '';
    }
}
