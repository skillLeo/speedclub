<?php

namespace App\Http\Resources\V1;

use App\Services\AppConfig\AppConfig;
use App\Services\Messaging\Realtime;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * @property array<string, mixed> $resource
 */
class AppConfigResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            /** @var array{ios: string, android: string} */
            'min_version' => $this->resource['min_version'],
            /** @var array{ios: string, android: string} */
            'latest_version' => $this->resource['latest_version'],
            /**
             * M3.5 ADM-37: the text SYS-02 shows when the installed version is below min_version, in the request's language; null keeps
             * the bundled text.
             *
             * @var string|null
             */
            'force_update_message' => $this->resource['force_update_message'],
            /** @var array{enabled: bool, message: string|null} */
            'maintenance' => $this->resource['maintenance'],
            /** @var array<string, bool> */
            'flags' => (object) $this->resource['flags'],
            /**
             * M3.5 ADM-28 adds `logos` (the logo set; the wordmarks default to the bundled files), `logo_sizes` (each logo's intrinsic width
             * and height in px, so a custom wordmark keeps its aspect ratio; null for a slot without a logo), `heroes` (welcome = FS-1, landing =
             * WEB-03, splash: photo with WebP variants [{width, url}] smallest first, blurhash and the focal point 0–1 for contentPosition; null keeps the
             * bundled photo) and `og_default`. `accent_set` is a key of the pre-validated accent palette (tokens accentPalette).
             *
             * @var array{logo: string|null, splash_image: string|null, welcome_hero: string|null, accent_set: string, default_theme: string, logos?: array{wordmark_white: string|null, wordmark_black: string|null, square: string|null, app_mark: string|null}, logo_sizes?: array{wordmark_white: array{width: int, height: int}|null, wordmark_black: array{width: int, height: int}|null, square: array{width: int, height: int}|null, app_mark: array{width: int, height: int}|null}, heroes?: array{welcome: array{url: string|null, variants: list<array{width: int, url: string}>, width: int, height: int, blurhash: string|null, focal_x: float, focal_y: float}|null, landing: array{url: string|null, variants: list<array{width: int, url: string}>, width: int, height: int, blurhash: string|null, focal_x: float, focal_y: float}|null, splash: array{url: string|null, variants: list<array{width: int, url: string}>, width: int, height: int, blurhash: string|null, focal_x: float, focal_y: float}|null}, og_default?: string|null}
             */
            'branding' => $this->resource['branding'],
            /**
             * Current announcements (ADM-30). M3.5 adds `cta_label` (the button text for `link`, an internal path or an https URL),
             * `audience` (all, new = registered ≤ 14 days, with_vehicles; the app decides per member, guests see only all),
             * `dismissible` (store dismissals per id on the device) and the schedule `starts_at`/`ends_at`.
             *
             * @var list<array{id: string, title: string, body: string, severity: string, link: string|null, cta_label?: string|null, audience?: 'all'|'new'|'with_vehicles', dismissible?: bool, starts_at?: string|null, ends_at?: string|null}>
             */
            'announcements' => $this->resource['announcements'],
            /** @var array<string, string|null> */
            'legal_versions' => $this->resource['legal_versions'],
            /**
             * M3.5 ADM-31: per re-consent document (terms, privacy), the newest version published with "erfordert erneute Zustimmung",
             * else null. When it is set and changes, a signed-in app asks GET me/consents and shows the blocking sheet for `required`.
             *
             * @var array{terms: string|null, privacy: string|null}
             */
            'legal_reconsent' => $this->resource['legal_reconsent'],
            /** @var array<string, string|null> */
            'links' => $this->resource['links'],
            /**
             * Pusher Channels (EU) when the server has it, public values only; otherwise the app polls (M2.4).
             *
             * @var array{enabled: bool, key: string|null, cluster: string|null}
             */
            'realtime' => Realtime::publicConfig(),
        ];
    }

    /**
     * A staff preview (ADM-34) is one person's draft: never stored by a browser or a proxy, never indexed.
     */
    public function withResponse(Request $request, JsonResponse $response): void
    {
        if (app(AppConfig::class)->isPreview()) {
            $response->headers->set('X-Robots-Tag', 'noindex');
            $response->headers->set('X-SpeedClub-Preview', '1');
        }
    }
}
