<?php

namespace App\Http\Controllers\Web;

use App\Http\Controllers\Controller;
use App\Services\AppConfig\FeatureFlags;
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
     * in the fragment, which is no part of the path, so only the verified app or the member web gets it. The app claims the same paths
     * in its intent filters (mobile/app.config.ts APP_LINK_PATH_PREFIXES and APP_LINK_PATHS). M4.15 (ADR-453 e): SET-21 of the security
     * mail, in both spellings.
     */
    public const APP_PATHS = ['/v/*', '/u/*', '/c/*', '/C/*', '/app/reset-password', '/app/verify-email', '/auth/magic', '/auth/secure', '/app/auth/magic', '/app/auth/secure', '/settings/security/activity', '/app/settings/security/activity'];

    /**
     * M4.14 pages the app opens only while their flag is on: /b (BIZ-01, `businesses`) and /brands (BRD-01, `parts_catalogue`). With
     * the flag off the path stays with the browser, where the page answers 404 as well. M4.16 (ADR-449): /e (EVT-02, `events`), now that
     * the public page WEB-09 exists for a browser without the app.
     *
     * @var array<string, string> path => flag
     */
    public const FLAGGED_APP_PATHS = ['/b/*' => 'businesses', '/brands/*' => 'parts_catalogue', '/e/*' => 'events'];

    /**
     * Link-preview fetchers named in robots.txt. They get their own group in both modes: with indexing off they still reach the pages
     * people share and their images, so a link posted from staging still previews while the pages say noindex. Search engines follow
     * the * group. (WhatsApp, iMessage and Telegram's fetchers read no robots.txt; they are named for the ones that copy them.)
     */
    public const PREVIEW_AGENTS = ['Twitterbot', 'facebookexternalhit', 'Facebot', 'LinkedInBot', 'Slackbot', 'Slackbot-LinkExpanding', 'TelegramBot', 'WhatsApp', 'Discordbot', 'Pinterestbot', 'redditbot', 'SkypeUriPreview'];

    /**
     * What a shared link and its preview need: the landing page, the vehicle and member pages with their cards, the QR resolver that
     * redirects to a vehicle page (bots are not counted as scans, KnownBots), the brand files. M4.16: the event, business and brand pages.
     */
    public const SHARED_PATHS = ['/$', '/v/', '/u/', '/e/', '/b/', '/brands/', '/c/', '/C/', '/og/', '/brand/', '/storage/og/', '/app/v/', '/app/u/', '/site.webmanifest', '/favicon', '/apple-touch-icon.png', '/icon-'];

    /** What search engines may crawl while indexing is on (M4.16: /e/, /b/, /brands/; each page says noindex where its subject asks). */
    public const INDEXED_PATHS = ['/v/', '/u/', '/e/', '/b/', '/brands/', '/og/'];

    /** Never for a crawler. */
    public const PRIVATE_PATHS = ['/app/', '/admin', '/api/'];

    public function robots(): Response
    {
        $indexing = config()->boolean('speedclub.public_pages.allow_indexing');
        $previews = [
            ...array_map(fn (string $agent): string => 'User-agent: '.$agent, self::PREVIEW_AGENTS),
            ...array_map(fn (string $path): string => 'Allow: '.$path, self::SHARED_PATHS),
            ...($indexing ? array_map(fn (string $path): string => 'Disallow: '.$path, self::PRIVATE_PATHS) : ['Disallow: /']),
        ];

        $lines = $indexing
            ? [
                'User-agent: *',
                ...array_map(fn (string $path): string => 'Allow: '.$path, self::INDEXED_PATHS),
                ...array_map(fn (string $path): string => 'Disallow: '.$path, [...self::PRIVATE_PATHS, '/c/', '/C/']),
                '',
                ...$previews,
                '',
                'Sitemap: '.rtrim(config()->string('app.url'), '/').'/sitemap.xml',
            ]
            : [...$previews, '', 'User-agent: *', 'Disallow: /'];

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
     * and Play's signing key side by side. M4.6 (09 §8.2): get_login_creds lets Android's Credential Manager use the passkeys of this
     * site in the app.
     */
    public function assetLinks(): JsonResponse
    {
        $fingerprints = $this->fingerprints((string) config('speedclub.mobile.android_cert_sha256'));

        return $this->association($fingerprints === [] ? [] : [[
            'relation' => ['delegate_permission/common.handle_all_urls', 'delegate_permission/common.get_login_creds'],
            'target' => [
                'namespace' => 'android_app',
                'package_name' => config('speedclub.mobile.android_package'),
                'sha256_cert_fingerprints' => $fingerprints,
            ],
        ]]);
    }

    public function appleAppSiteAssociation(FeatureFlags $flags): JsonResponse
    {
        $team = config('speedclub.mobile.ios_team_id');
        $bundle = config('speedclub.mobile.ios_bundle_id');

        $app = is_string($team) && $team !== '' && is_string($bundle) && $bundle !== '' ? $team.'.'.$bundle : null;
        $details = $app !== null ? [[
            'appIDs' => [$app],
            'components' => array_map(fn (string $path): array => ['/' => $path], self::appPaths($flags)),
        ]] : [];

        // M4.6 (09 §8.2): webcredentials for the app's passkeys and saved credentials; empty until the Team ID exists (OA-15).
        return $this->association(['applinks' => ['details' => $details], 'webcredentials' => ['apps' => $app !== null ? [$app] : []]]);
    }

    /**
     * APP_PATHS and the flagged paths whose flag is on now.
     *
     * @return list<string>
     */
    public static function appPaths(FeatureFlags $flags): array
    {
        $flagged = array_keys(array_filter(self::FLAGGED_APP_PATHS, fn (string $flag): bool => $flags->enabled($flag)));

        return [...self::APP_PATHS, ...$flagged];
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
