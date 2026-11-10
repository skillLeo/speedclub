<?php

namespace App\Services\PublicPages;

use App\Enums\VehicleStatus;
use App\Enums\Visibility;
use App\Models\QrCode;
use App\Models\Vehicle;
use App\Services\Qr\QrCodes;
use App\Services\Qr\QrRenderer;
use App\Support\PublicUrl;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\HtmlString;

/**
 * What WEB-03 prints. The featured build and the code beside it are real: speedclub.public_pages.featured_slug names one, otherwise
 * the public vehicle with the most mods whose owner allows search engines. No build at all simply means no such section.
 */
class LandingPage
{
    private const CANDIDATES = 5;

    public function __construct(
        private readonly PublicPageData $pages,
        private readonly QrCodes $codes,
        private readonly QrRenderer $renderer,
    ) {}

    /**
     * @return array<string, mixed>
     */
    public function data(Request $request): array
    {
        $vehicle = $this->featured();
        $qr = $vehicle?->activeQrCode;

        return [
            'featured' => $vehicle === null ? null : $this->pages->vehicle($vehicle, $request),
            'qr' => $vehicle === null || $qr === null ? null : $this->sample($vehicle, $qr),
            'canonical' => url('/'),
            'store_ios' => config('speedclub.mobile.store_url_ios') ?: null,
            'store_android' => config('speedclub.mobile.store_url_android') ?: null,
        ];
    }

    /**
     * The sticker's look with the page's address. Its /C/ address would count every click and every scan of the screen as a scan of
     * this member's sticker (QR-02, ADM-06), and a camera pointed at a screen cannot say where it came from.
     *
     * @return array{svg: HtmlString, code: string, url: string}
     */
    private function sample(Vehicle $vehicle, QrCode $qr): array
    {
        $page = '/v/'.$vehicle->canonicalSlug();
        $svg = $this->renderer->svg(rtrim(config()->string('app.url'), '/').$page);

        return [
            'svg' => new HtmlString((string) preg_replace('/^<\?xml.*?\?>\s*/s', '', $svg)),
            'code' => $this->codes->displayCode($qr->code),
            'url' => PublicUrl::to($page),
        ];
    }

    private function featured(): ?Vehicle
    {
        $slug = config('speedclub.public_pages.featured_slug');

        if (is_string($slug) && $slug !== '') {
            $named = Vehicle::findBySlug($slug);

            if ($named !== null && $this->showable($named)) {
                return $named;
            }
        }

        return Vehicle::query()
            ->where('status', VehicleStatus::Published)
            ->where('visibility', Visibility::Public)
            ->has('media')
            ->whereHas('owner', fn ($owner) => $owner->where('indexable', true))
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
            && $vehicle->owner?->getAttribute('indexable') !== false;
    }
}
