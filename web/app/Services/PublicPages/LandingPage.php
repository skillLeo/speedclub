<?php

namespace App\Services\PublicPages;

use App\Enums\EventStatus;
use App\Enums\EventVisibility;
use App\Enums\VehicleStatus;
use App\Enums\Visibility;
use App\Http\Resources\V1\EventCardResource;
use App\Http\Resources\V1\VehicleCardResource;
use App\Models\Event;
use App\Models\QrCode;
use App\Models\Vehicle;
use App\Services\AppConfig\FeatureFlags;
use App\Services\Events\EventFeed;
use App\Services\Events\EventPresenter;
use App\Services\Qr\QrCodes;
use App\Services\Qr\QrRenderer;
use App\Services\Showcase\SampleContent;
use App\Support\PublicUrl;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\HtmlString;

/**
 * What WEB-03 prints (09 §9). The featured builds and the code beside the lead are real: speedclub.public_pages.featured_slug names the
 * lead, the others are the public vehicles with the most mods whose owners allow search engines (Beispiel-badged while samples show).
 * M4.16: up to three builds for the editorial grid (one 8-column lead, two 4-column), the next three public meets while `events` is on,
 * and whether the business teaser shows (`businesses`). No build or meet at all simply means no such section.
 */
class LandingPage
{
    private const CANDIDATES = 12;

    private const FEATURED = 3;

    private const EVENTS = 3;

    public function __construct(
        private readonly PublicPageData $pages,
        private readonly QrCodes $codes,
        private readonly QrRenderer $renderer,
        private readonly FeatureFlags $flags,
        private readonly EventFeed $events,
        private readonly EventPresenter $presenter,
    ) {}

    /**
     * @return array<string, mixed>
     */
    public function data(Request $request): array
    {
        $featured = $this->featured();
        $vehicle = $featured[0] ?? null;
        $qr = $vehicle?->activeQrCode;

        return [
            'featured' => $vehicle === null ? null : $this->pages->vehicle($vehicle, $request),
            'more' => array_map(fn (Vehicle $more): array => $this->resolve(new VehicleCardResource($more->loadMissing(VehicleCardResource::RELATIONS)), $request), array_slice($featured, 1)),
            'qr' => $vehicle === null || $qr === null ? null : $this->sample($vehicle, $qr),
            'events' => $this->upcoming($request),
            'businesses' => $this->flags->enabled('businesses'),
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

    /**
     * The next public meets a guest may see (EventFeed::listed: published, not over, visible organiser, samples only while shown), as
     * EventCards, earliest first; none while `events` is off. Followers-only and unlisted meets stay out of an indexed page.
     *
     * @return list<array<string, mixed>>
     */
    private function upcoming(Request $request): array
    {
        if (! $this->flags->enabled('events')) {
            return [];
        }

        $events = $this->events->listed(null)
            ->where('events.status', EventStatus::Published->value)
            ->where('events.visibility', EventVisibility::Public->value)
            ->orderBy('events.starts_at')->orderBy('events.id')
            ->limit(self::EVENTS)->get();
        $this->presenter->prepare($events, null);

        return array_values($events->map(fn (Event $event): array => $this->resolve(new EventCardResource($event), $request))->all());
    }

    /**
     * @return array<string, mixed>
     */
    private function resolve(JsonResource $resource, Request $request): array
    {
        /** @var array<string, mixed> $data */
        $data = json_decode((string) json_encode($resource->resolve($request)), true);

        return $data;
    }

    /**
     * The lead first (the named one, else the build with the most mods), then the next showable ones, at most FEATURED.
     *
     * @return list<Vehicle>
     */
    private function featured(): array
    {
        $slug = config('speedclub.public_pages.featured_slug');
        $named = is_string($slug) && $slug !== '' ? Vehicle::findBySlug($slug) : null;
        $named = $named !== null && $this->showable($named) ? $named : null;

        $candidates = Vehicle::query()
            ->where('status', VehicleStatus::Published)
            ->where('visibility', Visibility::Public)
            ->has('media')
            // Samples never feature on the indexed landing page while editorial_samples is off: filtered before the top-N cut, so they
            // cannot crowd real builds out of the candidates.
            ->when(! app(SampleContent::class)->visible(), fn ($hidden) => $hidden->where('is_sample', false))
            ->whereHas('owner', fn ($owner) => $owner->where('indexable', true)
                ->when(! app(SampleContent::class)->visible(), fn ($hidden) => $hidden->where('is_sample', false)))
            ->withCount('modifications')
            ->orderByDesc('modifications_count')
            ->orderBy('id')
            ->limit(self::CANDIDATES)
            ->get()
            ->filter(fn (Vehicle $vehicle): bool => $vehicle->id !== $named?->id && $this->showable($vehicle))
            ->values()
            ->all();
        // One build per owner while there are enough owners: an editorial grid of one garage reads as a profile.
        $picked = [];
        $owners = [];

        foreach ([[$named, ...$candidates], [...$candidates]] as $pass => $list) {
            foreach ($list as $vehicle) {
                if ($vehicle === null || count($picked) >= self::FEATURED || isset($picked[$vehicle->id]) || ($pass === 0 && isset($owners[$vehicle->owner_id]))) {
                    continue;
                }

                $picked[$vehicle->id] = $vehicle;
                $owners[$vehicle->owner_id] = true;
            }
        }

        return array_values($picked);
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
