<?php

namespace App\Services\AppConfig;

use App\Enums\AnnouncementAudience;
use App\Enums\ConfigKey;
use App\Enums\ConfigVersionStatus;
use App\Enums\LegalDocumentKey;
use App\Enums\ThemePreference;
use App\Models\BrandAsset;
use App\Models\ConfigVersion;
use App\Models\FeatureFlag;
use App\Services\Brand\BrandAssets;
use App\Services\Config\PreviewContext;
use App\Services\Config\PreviewTokens;
use Closure;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Cache;
use Throwable;

/**
 * What GET /app-config returns (05_ARCHITECTURE §12): the latest published config_versions row per key over the defaults
 * in config/speedclub.php, the public feature flags and the current legal versions. Unusable values in a payload fall
 * back to the default, so one bad publish cannot take clients down. ConfigVersions, flag and legal changes call flush(), so the next
 * request answers the new payload with a new ETag (05_ARCHITECTURE §12, m3.5 §1).
 *
 * Payload keys (App\Services\Config\Schemas): remote_config {min_version, latest_version, force_update_message{de, en},
 * maintenance{enabled, message{de, en}}}, branding {logos{…: asset id}, heroes{welcome, landing, splash: {asset_id, focal_x, focal_y}},
 * og_default, accent_set, default_theme, and the bundled paths logo, splash_image, welcome_hero of the first install},
 * announcements {items[{id, title{de, en}, body{de, en}, cta{label{de, en}, url}, audience, starts_at, ends_at, dismissible,
 * severity}]} (older items carry link instead of cta), links {name: url}.
 *
 * A valid staff preview token on the request (ADM-34, PreviewTokens) overlays that staff member's drafts for this request only,
 * uncached; with one, maintenance mode is bypassed unless the remote_config draft is what is previewed.
 *
 * @phpstan-type Announcement array{id: string, title: string, body: string, severity: string, link: string|null, cta_label: string|null, audience: string, dismissible: bool, starts_at: string|null, ends_at: string|null}
 * @phpstan-type Hero array{url: string|null, variants: list<array{width: int, url: string}>, width: int, height: int, blurhash: string|null, focal_x: float, focal_y: float}
 * @phpstan-type Branding array{logo: string|null, splash_image: string|null, welcome_hero: string|null, accent_set: string, default_theme: string, logos: array<string, string|null>, logo_sizes: array<string, array{width: int, height: int}|null>, heroes: array<string, Hero|null>, og_default: string|null}
 * @phpstan-type Payload array{
 *     min_version: array{ios: string, android: string},
 *     latest_version: array{ios: string, android: string},
 *     force_update_message: string|null,
 *     maintenance: array{enabled: bool, message: string|null},
 *     flags: array<string, bool>,
 *     branding: Branding,
 *     announcements: list<Announcement>,
 *     legal_versions: array<string, string|null>,
 *     legal_reconsent: array<string, string|null>,
 *     links: array<string, string|null>,
 * }
 */
class AppConfig
{
    /** The client's own wordmark files in web/public/brand (M1.4), until ADM-28 publishes others. */
    private const BUNDLED_WORDMARKS = [
        'wordmark_white' => '/brand/logo-wide-white-640.webp',
        'wordmark_black' => '/brand/logo-wide-black-640.webp',
    ];

    /** Both bundled wordmarks are 640 × 192. */
    private const BUNDLED_WORDMARK_SIZE = ['width' => 640, 'height' => 192];

    private ?PreviewContext $preview = null;

    public function __construct(
        private readonly LegalDocuments $legal,
        private readonly PreviewTokens $previews,
        private readonly BrandAssets $assets,
    ) {}

    /**
     * @return Payload
     */
    public function forLocale(string $locale): array
    {
        $preview = $this->previews->current();

        if ($preview !== null) {
            return $this->withAbsoluteUrls($this->previewing($preview, fn (): array => $this->build($locale)));
        }

        /** @var Payload $payload */
        $payload = Cache::remember($this->cacheKey($locale), config()->integer('speedclub.app_config.cache_seconds'), fn (): array => $this->build($locale));

        return $this->withAbsoluteUrls($payload);
    }

    /** Whether the current request reads a staff preview (so no cache may keep its answer). */
    public function isPreview(): bool
    {
        return $this->previews->current() !== null;
    }

    /**
     * The OG image of a page without its own: the published (or previewed) branding's og_default, else config. Read from the cached
     * app-config payload (SF-7: no query per public page view); a publish flushes it with the rest, a preview builds it uncached.
     */
    public function ogDefaultUrl(): string
    {
        /** @var list<string> $locales */
        $locales = config('speedclub.locales');
        $locale = in_array(app()->getLocale(), $locales, true) ? app()->getLocale() : $locales[0];
        $og = $this->forLocale($locale)['branding']['og_default'];

        return is_string($og) && $og !== '' ? $og : url(config()->string('speedclub.public_pages.og_default'));
    }

    /**
     * @template T
     *
     * @param  Closure(): T  $build
     * @return T
     */
    private function previewing(PreviewContext $preview, Closure $build): mixed
    {
        $previous = $this->preview;
        $this->preview = $preview;

        try {
            return $build();
        } finally {
            $this->preview = $previous;
        }
    }

    public function flush(): void
    {
        /** @var list<string> $locales */
        $locales = config('speedclub.locales');

        foreach ($locales as $locale) {
            Cache::forget($this->cacheKey($locale));
        }
    }

    /**
     * The cached payload holds paths. They become URLs per request, so one Host header cannot reach other clients and
     * LAN clients get reachable URLs.
     *
     * @param  Payload  $payload
     * @return Payload
     */
    private function withAbsoluteUrls(array $payload): array
    {
        foreach (['logo', 'splash_image', 'welcome_hero', 'og_default'] as $image) {
            $payload['branding'][$image] = $this->absolute($payload['branding'][$image]);
        }

        $payload['branding']['logos'] = array_map($this->absolute(...), $payload['branding']['logos']);

        foreach ($payload['branding']['heroes'] as $slot => $hero) {
            if ($hero !== null) {
                $hero['url'] = $this->absolute($hero['url']);
                $hero['variants'] = array_map(fn (array $variant): array => ['width' => $variant['width'], 'url' => (string) $this->absolute($variant['url'])], $hero['variants']);
                $payload['branding']['heroes'][$slot] = $hero;
            }
        }

        $payload['links'] = array_map($this->absolute(...), $payload['links']);

        return $payload;
    }

    /**
     * @return Payload
     */
    private function build(string $locale): array
    {
        $remote = $this->section('remote_config');
        $branding = $this->section('branding');
        $defaultBranding = $this->defaults('branding');
        $defaultRemote = $this->defaults('remote_config');
        $maintenance = is_array($remote['maintenance'] ?? null) ? $remote['maintenance'] : [];
        // The staff bypass (ADM-37): a preview shows the app as it is, unless the maintenance draft itself is previewed.
        $bypass = $this->preview !== null && $this->preview->payload(ConfigKey::RemoteConfig) === null;
        $logos = is_array($branding['logos'] ?? null) ? $branding['logos'] : [];
        $heroes = is_array($branding['heroes'] ?? null) ? $branding['heroes'] : [];
        $assets = $this->brandAssets([...array_values($logos), ...array_map(fn (mixed $hero): mixed => is_array($hero) ? ($hero['asset_id'] ?? null) : null, array_values($heroes)), $branding['og_default'] ?? null]);
        $logo = fn (string $slot, int $width): ?string => isset($assets[$logos[$slot] ?? '']) ? $this->assets->path($assets[$logos[$slot]], $width) : null;
        $size = fn (string $slot): ?array => isset($assets[$logos[$slot] ?? '']) ? ['width' => $assets[$logos[$slot]]->width, 'height' => $assets[$logos[$slot]]->height] : null;
        $hero = fn (string $slot): ?array => $this->hero($heroes[$slot] ?? null, $assets);
        $resolvedHeroes = ['welcome' => $hero('welcome'), 'landing' => $hero('landing'), 'splash' => $hero('splash')];
        $og = $assets[$this->stringOrNull($branding['og_default'] ?? null) ?? ''] ?? null;

        return [
            'min_version' => $this->versions($remote['min_version'] ?? null, $defaultRemote['min_version'] ?? null),
            'latest_version' => $this->versions($remote['latest_version'] ?? null, $defaultRemote['latest_version'] ?? null),
            'force_update_message' => $this->localized($remote['force_update_message'] ?? null, $locale),
            'maintenance' => [
                'enabled' => ! $bypass && ($maintenance['enabled'] ?? false) === true,
                'message' => $this->localized($maintenance['message'] ?? null, $locale),
            ],
            'flags' => $this->publicFlags(),
            'branding' => [
                'logo' => $logo('wordmark_white', 640) ?? $this->stringOrNull($branding['logo'] ?? null),
                'splash_image' => $resolvedHeroes['splash']['url'] ?? $this->stringOrNull($branding['splash_image'] ?? null),
                'welcome_hero' => $resolvedHeroes['welcome']['url'] ?? $this->stringOrNull($branding['welcome_hero'] ?? null),
                'accent_set' => $this->stringOrNull($branding['accent_set'] ?? null) ?? (string) $this->stringOrNull($defaultBranding['accent_set'] ?? null),
                'default_theme' => $this->theme($branding['default_theme'] ?? null) ?? (string) $this->stringOrNull($defaultBranding['default_theme'] ?? null),
                'logos' => [
                    'wordmark_white' => $logo('wordmark_white', 640) ?? self::BUNDLED_WORDMARKS['wordmark_white'],
                    'wordmark_black' => $logo('wordmark_black', 640) ?? self::BUNDLED_WORDMARKS['wordmark_black'],
                    'square' => $logo('square', 640),
                    'app_mark' => $logo('app_mark', 640),
                ],
                // The intrinsic size of each logo (the app sizes a custom wordmark by its aspect ratio, never stretched); null for a slot without one.
                'logo_sizes' => [
                    'wordmark_white' => $size('wordmark_white') ?? self::BUNDLED_WORDMARK_SIZE,
                    'wordmark_black' => $size('wordmark_black') ?? self::BUNDLED_WORDMARK_SIZE,
                    'square' => $size('square'),
                    'app_mark' => $size('app_mark'),
                ],
                'heroes' => $resolvedHeroes,
                'og_default' => $og instanceof BrandAsset && is_string($og->og_path) ? $this->assets->publicPath($og->og_path) : null,
            ],
            'announcements' => $this->announcements($locale),
            'legal_versions' => $this->legalVersions($locale),
            'legal_reconsent' => $this->legalReconsent(),
            'links' => $this->links(),
        ];
    }

    /**
     * @param  list<mixed>  $ids
     * @return array<string, BrandAsset>
     */
    private function brandAssets(array $ids): array
    {
        $ids = array_values(array_unique(array_filter($ids, fn (mixed $id): bool => is_string($id) && $id !== '')));

        try {
            return $ids === [] ? [] : BrandAsset::query()->whereKey($ids)->get()->keyBy('id')->all();
        } catch (Throwable) {
            return [];
        }
    }

    /**
     * @param  array<string, BrandAsset>  $assets
     * @return Hero|null
     */
    private function hero(mixed $slot, array $assets): ?array
    {
        $asset = is_array($slot) && is_string($slot['asset_id'] ?? null) ? ($assets[$slot['asset_id']] ?? null) : null;

        if (! is_array($slot) || ! $asset instanceof BrandAsset) {
            return null;
        }

        $focal = fn (mixed $value): float => is_numeric($value) ? max(0.0, min(1.0, (float) $value)) : 0.5;

        return [
            'url' => $this->assets->path($asset, 1080),
            'variants' => array_map(fn (int $width, string $path): array => ['width' => $width, 'url' => $path], array_keys($this->assets->variantPaths($asset)), array_values($this->assets->variantPaths($asset))),
            'width' => $asset->width,
            'height' => $asset->height,
            'blurhash' => $asset->blurhash,
            'focal_x' => $focal($slot['focal_x'] ?? null),
            'focal_y' => $focal($slot['focal_y'] ?? null),
        ];
    }

    /**
     * Per re-consent document (terms, privacy), the newest published version that asked members to accept again, else null.
     *
     * @return array<string, string|null>
     */
    private function legalReconsent(): array
    {
        $versions = [];

        foreach (LegalDocuments::RECONSENT as $key) {
            $versions[$key->value] = $this->legal->reconsentVersion($key);
        }

        return $versions;
    }

    /**
     * Staff-only flags and partial rollouts are not on for an anonymous client.
     *
     * @return array<string, bool>
     */
    private function publicFlags(): array
    {
        $flags = [];

        foreach (FeatureFlag::query()->orderBy('key')->get() as $flag) {
            /** @var array<string, mixed> $rules */
            $rules = $flag->getAttribute('rules') ?? [];

            if (($rules['staff_only'] ?? false) === true || ($rules['public'] ?? true) === false) {
                continue;
            }

            $percentage = $rules['percentage'] ?? 100;

            /** @var string $key */
            $key = $flag->getAttribute('key');
            $flags[$key] = $flag->getAttribute('enabled') === true && is_numeric($percentage) && (float) $percentage >= 100;
        }

        return $flags;
    }

    /**
     * @return list<Announcement>
     */
    private function announcements(string $locale): array
    {
        $section = $this->published('announcements');
        $items = is_array($section['items'] ?? null) ? $section['items'] : [];
        $announcements = [];

        foreach ($items as $item) {
            if (! is_array($item) || ! $this->isCurrent($item)) {
                continue;
            }

            $id = $this->stringOrNull($item['id'] ?? null);
            $title = $this->localized($item['title'] ?? null, $locale);

            if ($id !== null && $title !== null) {
                $cta = is_array($item['cta'] ?? null) ? $item['cta'] : [];
                $audience = AnnouncementAudience::tryFrom((string) $this->stringOrNull($item['audience'] ?? null)) ?? AnnouncementAudience::All;

                $announcements[] = [
                    'id' => $id,
                    'title' => $title,
                    'body' => (string) $this->localized($item['body'] ?? null, $locale),
                    'severity' => $this->stringOrNull($item['severity'] ?? null) ?? 'info',
                    'link' => $this->stringOrNull($cta['url'] ?? null) ?? $this->stringOrNull($item['link'] ?? null),
                    'cta_label' => $this->localized($cta['label'] ?? null, $locale),
                    'audience' => $audience->value,
                    'dismissible' => ($item['dismissible'] ?? true) !== false,
                    'starts_at' => $this->stringOrNull($item['starts_at'] ?? null),
                    'ends_at' => $this->stringOrNull($item['ends_at'] ?? null),
                ];
            }
        }

        return $announcements;
    }

    /**
     * @param  array<array-key, mixed>  $item
     */
    private function isCurrent(array $item): bool
    {
        try {
            $starts = $this->stringOrNull($item['starts_at'] ?? null);
            $ends = $this->stringOrNull($item['ends_at'] ?? null);

            return ($starts === null || Carbon::parse($starts)->isPast()) && ($ends === null || Carbon::parse($ends)->isFuture());
        } catch (Throwable) {
            return false;
        }
    }

    /**
     * @return array<string, string|null>
     */
    private function legalVersions(string $locale): array
    {
        $versions = [];

        foreach (LegalDocumentKey::cases() as $key) {
            $versions[$key->value] = $this->legal->current($key, $locale)?->getAttribute('version');
        }

        return $versions;
    }

    /**
     * @return array<string, string|null>
     */
    private function links(): array
    {
        $links = [];

        foreach ($this->section('links') as $name => $link) {
            $links[(string) $name] = $this->stringOrNull($link);
        }

        return $links;
    }

    /**
     * @return array{ios: string, android: string}
     */
    private function versions(mixed $published, mixed $default): array
    {
        $published = is_array($published) ? $published : [];
        $default = is_array($default) ? $default : [];

        return [
            'ios' => $this->stringOrNull($published['ios'] ?? null) ?? (string) $this->stringOrNull($default['ios'] ?? null),
            'android' => $this->stringOrNull($published['android'] ?? null) ?? (string) $this->stringOrNull($default['android'] ?? null),
        ];
    }

    /**
     * A plain string or {de, en} with the German text as the fallback.
     */
    private function localized(mixed $value, string $locale): ?string
    {
        if (is_array($value)) {
            $value = $value[$locale] ?? $value[config()->array('speedclub.locales')[0]] ?? null;
        }

        return $this->stringOrNull($value);
    }

    /**
     * Native clients have no origin to resolve a path against.
     */
    private function absolute(mixed $value): ?string
    {
        $value = $this->stringOrNull($value);

        return $value !== null && str_starts_with($value, '/') ? url($value) : $value;
    }

    private function theme(mixed $value): ?string
    {
        $theme = ThemePreference::tryFrom((string) $this->stringOrNull($value));

        return $theme === null ? null : $theme->value;
    }

    private function stringOrNull(mixed $value): ?string
    {
        return is_string($value) && $value !== '' ? $value : null;
    }

    /**
     * @return array<array-key, mixed>
     */
    private function section(string $key): array
    {
        return array_replace_recursive($this->defaults($key), $this->published($key));
    }

    /**
     * @return array<array-key, mixed>
     */
    private function defaults(string $key): array
    {
        $defaults = config('speedclub.app_config.'.$key);

        return is_array($defaults) ? $defaults : [];
    }

    /**
     * @return array<array-key, mixed>
     */
    private function published(string $key): array
    {
        $previewed = ConfigKey::tryFrom($key) === null ? null : $this->preview?->payload(ConfigKey::from($key));

        if ($previewed !== null) {
            return $previewed;
        }

        $payload = ConfigVersion::query()
            ->where('key', $key)
            ->where('status', ConfigVersionStatus::Published)
            ->orderByDesc('version')
            ->value('payload');

        if (is_string($payload)) {
            $payload = json_decode($payload, true);
        }

        return is_array($payload) ? $payload : [];
    }

    private function cacheKey(string $locale): string
    {
        return 'app-config:'.$locale;
    }
}
