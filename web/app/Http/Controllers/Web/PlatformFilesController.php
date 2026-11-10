<?php

namespace App\Http\Controllers\Web;

use App\Http\Controllers\Controller;
use App\Services\PublicPages\SitemapWriter;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Response;

/**
 * The files machines ask for: robots, sitemap and the two association files that make /v, /u and /c open the installed app. Those two
 * come from env and must answer directly with application/json, because Android and iOS follow no redirect and accept nothing else.
 */
class PlatformFilesController extends Controller
{
    /**
     * /u joined with PROF-02 (M2.1). The two e-mail screens are exact paths (SEC-P2-03): WEB-07's app button points at them with the code
     * in the fragment, which is no part of the path, so only the verified app or the member web gets it. The app claims the same exact
     * paths in its intent filters (mobile/app.config.ts).
     */
    public const APP_PATHS = ['/v/*', '/u/*', '/c/*', '/C/*', '/app/reset-password', '/app/verify-email'];

    public function robots(): Response
    {
        $lines = config()->boolean('speedclub.public_pages.allow_indexing')
            ? [
                'User-agent: *',
                'Disallow: /app/',
                'Disallow: /admin/',
                'Disallow: /api/',
                'Disallow: /c/',
                'Disallow: /C/',
                '',
                'Sitemap: '.rtrim(config()->string('app.url'), '/').'/sitemap.xml',
            ]
            : ['User-agent: *', 'Disallow: /'];

        return new Response(implode("\n", $lines)."\n", 200, [
            'Content-Type' => 'text/plain; charset=UTF-8',
            'Cache-Control' => 'public, max-age=3600',
        ]);
    }

    public function sitemap(SitemapWriter $sitemap): Response
    {
        return new Response($sitemap->read(), 200, [
            'Content-Type' => 'application/xml; charset=UTF-8',
            'Cache-Control' => 'public, max-age=3600',
        ]);
    }

    /**
     * An empty list until a fingerprint is set, which is valid and links nothing. Several keys go comma separated, for the upload key
     * and Play's signing key side by side.
     */
    public function assetLinks(): JsonResponse
    {
        $fingerprints = $this->fingerprints((string) config('speedclub.mobile.android_cert_sha256'));

        return $this->association($fingerprints === [] ? [] : [[
            'relation' => ['delegate_permission/common.handle_all_urls'],
            'target' => [
                'namespace' => 'android_app',
                'package_name' => config('speedclub.mobile.android_package'),
                'sha256_cert_fingerprints' => $fingerprints,
            ],
        ]]);
    }

    public function appleAppSiteAssociation(): JsonResponse
    {
        $team = config('speedclub.mobile.ios_team_id');
        $bundle = config('speedclub.mobile.ios_bundle_id');

        $details = is_string($team) && $team !== '' && is_string($bundle) && $bundle !== '' ? [[
            'appIDs' => [$team.'.'.$bundle],
            'components' => array_map(fn (string $path): array => ['/' => $path], self::APP_PATHS),
        ]] : [];

        return $this->association(['applinks' => ['details' => $details]]);
    }

    /**
     * Android wants 64 hex digits in pairs, uppercase, with colons. Accepts them with or without colons, in any case.
     *
     * @return list<string>
     */
    private function fingerprints(string $configured): array
    {
        $fingerprints = [];

        foreach (explode(',', $configured) as $entry) {
            $hex = strtoupper(str_replace([':', ' '], '', $entry));

            if (preg_match('/\A[0-9A-F]{64}\z/', $hex) === 1) {
                $fingerprints[] = implode(':', str_split($hex, 2));
            }
        }

        return $fingerprints;
    }

    /**
     * @param  array<array-key, mixed>  $body
     */
    private function association(array $body): JsonResponse
    {
        return new JsonResponse($body, 200, ['Content-Type' => 'application/json', 'Cache-Control' => 'public, max-age=3600'], JSON_UNESCAPED_SLASHES);
    }
}
