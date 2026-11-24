<?php

namespace App\Services\PublicPages;

use App\Enums\VehicleStatus;
use App\Enums\Visibility;
use App\Models\Vehicle;
use App\Services\AppConfig\FeatureFlags;
use App\Services\Dex\GhostMode;
use App\Services\Qr\QrCodes;
use App\Services\Qr\QrRenderer;
use App\Services\Showcase\SampleContent;
use App\Support\PublicUrl;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\HtmlString;

/**
 * What WEB-03 prints (R4-1.5, client round 4: the short landing page). Hero, "Was du mit Speedclub machst", the sticker block, the
 * download section. The code in the sticker block is real: it leads to the lead build (speedclub.public_pages.featured_slug, else the
 * public build with the most mods whose owner allows search engines, Beispiel only while samples show); no such build means no code.
 * The store buttons are the configured store links; without them "App laden" leads to WEB-04 (/app-laden).
 */
class LandingPage
{
    private const CANDIDATES = 12;

    public function __construct(
        private readonly QrCodes $codes,
        private readonly QrRenderer $renderer,
        private readonly FeatureFlags $flags,
    ) {}

    /**
     * @return array{qr: array{svg: HtmlString, url: string, sample: bool, editorial: bool}|null, shop: string|null, canonical: string, stores: array<string, string>}
     */
    public function data(Request $request): array
    {
        $vehicle = $this->lead();

        return [
            'qr' => $vehicle === null || $vehicle->activeQrCode === null ? null : $this->sample($vehicle),
            // The sticker block's link to the shop, only while the shop exists (client round 2, as the top bar and the footer).
            'shop' => $this->flags->enabled('shop') ? url('/app/shop') : null,
            'canonical' => url('/'),
            'stores' => array_filter([
                'App Store' => self::link(config('speedclub.mobile.store_url_ios')),
                'Google Play' => self::link(config('speedclub.mobile.store_url_android')),
            ]),
        ];
    }

    /**
     * Only an absolute https or http address counts as a configured store (as WEB-04).
     */
    private static function link(mixed $value): ?string
    {
        return is_string($value) && preg_match('#^https?://\S+$#i', trim($value)) === 1 ? trim($value) : null;
    }

    /**
     * The sticker's look with the page's address. Its /C/ address would count every click and every scan of the screen as a scan of
     * this member's sticker (QR-02, ADM-06), and a camera pointed at a screen cannot say where it came from. The sticker code is not
     * printed under it either (ADR-514): typed off a public page it would count as a STREET DEX spot without standing at the car.
     *
     * A sample build's code says so (Beispiel, and Redaktion for the Editorial account), never "ein echter Build".
     *
     * @return array{svg: HtmlString, url: string, sample: bool, editorial: bool}
     */
    private function sample(Vehicle $vehicle): array
    {
        $page = '/v/'.$vehicle->canonicalSlug();
        $svg = $this->renderer->svg($this->codes->pageUrl($vehicle));

        return [
            'svg' => new HtmlString((string) preg_replace('/^<\?xml.*?\?>\s*/s', '', $svg)),
            'url' => PublicUrl::to($page),
            'sample' => $vehicle->getAttribute('is_sample') === true,
            'editorial' => $vehicle->owner?->getAttribute('is_editorial') === true,
        ];
    }

    /**
     * The build the sticker block's code leads to: the named lead when it can be shown, else the showable public build with the most
     * mods.
     */
    public function lead(): ?Vehicle
    {
        $slug = config('speedclub.public_pages.featured_slug');
        $named = is_string($slug) && $slug !== '' ? Vehicle::findBySlug($slug) : null;

        if ($named !== null && $this->showable($named)) {
            return $named;
        }

        return Vehicle::query()
            ->where('status', VehicleStatus::Published)
            ->where('visibility', Visibility::Public)
            // M5.9b: no ghost car on the indexed landing page.
            ->where(fn ($query) => GhostMode::constrain($query))
            ->has('media')
            // Samples never lead on the indexed landing page while editorial_samples is off: filtered before the top-N cut.
            ->when(! app(SampleContent::class)->visible(), fn ($hidden) => $hidden->where('is_sample', false))
            ->whereHas('owner', fn ($owner) => $owner->where('indexable', true)
                ->when(! app(SampleContent::class)->visible(), fn ($hidden) => $hidden->where('is_sample', false)))
            ->withCount('modifications')
            ->orderByDesc('modifications_count')
            ->orderBy('id')
            ->limit(self::CANDIDATES)
            ->get()
            ->first(fn (Vehicle $vehicle): bool => $this->showable($vehicle));
    }

    /**
     * The test a stranger's visit has to pass, so suspensions and hidden owners stay out without a second list of rules. The landing
     * page is indexed and in the sitemap, so an owner who switched search engines off is not featured either, also not by slug.
     */
    private function showable(Vehicle $vehicle): bool
    {
        $vehicle->loadMissing('owner');

        return Gate::forUser(null)->allows('view', $vehicle)
            && $vehicle->visibility === Visibility::Public
            && ! GhostMode::hides($vehicle)
            && $vehicle->owner?->getAttribute('indexable') !== false;
    }
}
