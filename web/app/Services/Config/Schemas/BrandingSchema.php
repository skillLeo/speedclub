<?php

namespace App\Services\Config\Schemas;

use App\Enums\BrandAssetKind;
use App\Enums\ConfigKey;
use App\Enums\ThemePreference;
use App\Models\BrandAsset;
use App\Services\Brand\AccentSets;
use App\Services\Brand\HeroContrast;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rule;

/**
 * `branding` (ADM-28, 03_DESIGN_SYSTEM §2/§3, FS-1):
 * {logos: {wordmark_white, wordmark_black, square, app_mark: asset id|null}, heroes: {welcome, landing, splash: {asset_id, focal_x,
 * focal_y}|null}, og_default: asset id|null, accent_set: a pre-validated set key, default_theme: carbon|black|light|system}, plus the
 * bundled paths of the first install (logo, splash_image, welcome_hero: "/brand/…") that older versions carry. Every asset must be of
 * its slot's kind; every hero must pass the contrast rule at its focal point (HeroContrast), else the draft is refused.
 */
final class BrandingSchema extends Schema
{
    public const LOGOS = ['wordmark_white', 'wordmark_black', 'square', 'app_mark'];

    public const HEROES = ['welcome', 'landing', 'splash'];

    private const LEGACY = ['logo', 'splash_image', 'welcome_hero'];

    public function __construct(private readonly AccentSets $accents, private readonly HeroContrast $contrast) {}

    public function key(): ConfigKey
    {
        return ConfigKey::Branding;
    }

    public function normalize(array $payload): array
    {
        $rules = [
            'logos' => ['nullable', 'array'],
            'heroes' => ['nullable', 'array'],
            'og_default' => ['nullable', 'string', 'ulid'],
            'accent_set' => ['required', 'string', 'max:40'],
            'default_theme' => ['required', Rule::enum(ThemePreference::class)],
        ];

        foreach (self::LOGOS as $logo) {
            $rules["logos.$logo"] = ['nullable', 'string', 'ulid'];
        }

        foreach (self::HEROES as $hero) {
            $rules["heroes.$hero"] = ['nullable', 'array'];
            $rules["heroes.$hero.asset_id"] = ["required_with:heroes.$hero", 'string', 'ulid'];
            $rules["heroes.$hero.focal_x"] = ['nullable', 'numeric', 'between:0,1'];
            $rules["heroes.$hero.focal_y"] = ['nullable', 'numeric', 'between:0,1'];
        }

        foreach (self::LEGACY as $legacy) {
            $rules[$legacy] = ['nullable', 'string', 'max:200', 'regex:#\A/brand/[A-Za-z0-9._/-]+\z#'];
        }

        $data = Validator::make($payload, $rules)->validate();

        $accent = $this->accents->resolve($data['accent_set']);

        if ($accent === null) {
            $this->refuse(['accent_set' => (string) __('content.brand.accent')]);
        }

        $logos = [];
        $wanted = [];

        foreach (self::LOGOS as $logo) {
            $logos[$logo] = isset($data['logos'][$logo]) ? strtolower((string) $data['logos'][$logo]) : null;

            if ($logos[$logo] !== null) {
                $wanted["logos.$logo"] = [$logos[$logo], BrandAssetKind::from($logo)];
            }
        }

        $heroes = [];

        foreach (self::HEROES as $hero) {
            $slot = $data['heroes'][$hero] ?? null;
            $heroes[$hero] = $slot === null ? null : [
                'asset_id' => strtolower((string) $slot['asset_id']),
                'focal_x' => round((float) ($slot['focal_x'] ?? 0.5), 3),
                'focal_y' => round((float) ($slot['focal_y'] ?? 0.5), 3),
            ];

            if ($heroes[$hero] !== null) {
                $wanted["heroes.$hero.asset_id"] = [$heroes[$hero]['asset_id'], BrandAssetKind::Hero];
            }
        }

        $og = isset($data['og_default']) ? strtolower((string) $data['og_default']) : null;

        if ($og !== null) {
            $wanted['og_default'] = [$og, BrandAssetKind::Og];
        }

        $assets = BrandAsset::query()->whereKey(array_map(fn (array $entry): string => $entry[0], $wanted))->get()->keyBy('id');
        $errors = [];

        foreach ($wanted as $field => [$id, $kind]) {
            $asset = $assets->get($id);

            if (! $asset instanceof BrandAsset || $asset->kind !== $kind) {
                $errors[$field] = (string) __('content.brand.asset_kind');
            }
        }

        foreach ($heroes as $hero => $slot) {
            $asset = $slot === null ? null : $assets->get($slot['asset_id']);

            if ($slot !== null && $asset instanceof BrandAsset && $asset->kind === BrandAssetKind::Hero) {
                $result = $this->contrast->forAsset($asset, $slot['focal_x'], $slot['focal_y']);

                if (! $result->passes()) {
                    $errors["heroes.$hero.asset_id"] = (string) __('content.brand.hero_contrast', [
                        'ratio' => number_format(min($result->logoRatio, $result->textRatio), 1, ',', ''),
                        'minimum' => number_format($result->minimum, 1, ',', ''),
                    ]);
                }
            }
        }

        if ($errors !== []) {
            $this->refuse($errors);
        }

        $normalized = [
            'logos' => $logos,
            'heroes' => $heroes,
            'og_default' => $og,
            'accent_set' => $accent,
            'default_theme' => (string) $data['default_theme'],
        ];

        foreach (self::LEGACY as $legacy) {
            if (is_string($data[$legacy] ?? null)) {
                $normalized[$legacy] = $data[$legacy];
            }
        }

        return $normalized;
    }

    public function initial(): array
    {
        $defaults = config()->array('speedclub.app_config.branding');

        return [
            'logos' => array_fill_keys(self::LOGOS, null),
            'heroes' => array_fill_keys(self::HEROES, null),
            'og_default' => null,
            'accent_set' => $this->accents->defaultKey(),
            'default_theme' => is_string($defaults['default_theme'] ?? null) ? $defaults['default_theme'] : ThemePreference::Carbon->value,
            ...array_filter(['logo' => $defaults['logo'] ?? null, 'splash_image' => $defaults['splash_image'] ?? null], is_string(...)),
        ];
    }
}
