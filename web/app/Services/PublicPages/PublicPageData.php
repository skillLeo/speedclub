<?php

namespace App\Services\PublicPages;

use App\Enums\VehicleStatus;
use App\Enums\Visibility;
use App\Http\Middleware\PublicPageContext;
use App\Http\Resources\V1\MemberProfileResource;
use App\Http\Resources\V1\PublicVehicleResource;
use App\Http\Resources\V1\VehicleCardResource;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\AppConfig\FeatureFlags;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * What WEB-01 and WEB-02 print. The page data is the API's own resource, resolved to plain arrays, so Blade and the app show the same
 * values in the same words by construction (03_DESIGN_SYSTEM §12). This class only adds what a web page has and the API does not:
 * SEO, the OG image, and the links of the sticky bar.
 */
class PublicPageData
{
    public function __construct(private readonly OgImages $og) {}

    /**
     * @return array<string, mixed>
     */
    public function vehicle(Vehicle $vehicle, Request $request): array
    {
        $vehicle->load(PublicVehicleResource::DETAIL_RELATIONS);

        $data = $this->resolve(new PublicVehicleResource($vehicle), $request);
        $canonical = url('/v/'.$vehicle->canonicalSlug());
        $owner = $vehicle->owner;
        $showOwner = $owner?->getAttribute('show_owner_on_qr') !== false;
        $indexable = $vehicle->visibility === Visibility::Public && $owner?->getAttribute('indexable') !== false;
        $title = is_string($data['full_title'] ?? null) ? $data['full_title'] : '';
        $image = $this->og->forVehicle($vehicle);

        // The owner asked not to be named on the page a sticker leads to.
        if (! $showOwner) {
            $data['owner'] = null;
        }

        if ($this->forcedEmpty($request)) {
            $data = [...$data, 'photos' => [], 'photo_count' => 0, 'description' => null, 'highlights' => [], 'mods' => ['count' => 0, 'groups' => []], 'updates' => [], 'updates_count' => 0];
        }

        return [
            'vehicle' => $data,
            'show_owner' => $showOwner,
            'seo' => [
                'title' => __('public.vehicle.meta_title', ['title' => $title]),
                'description' => $this->vehicleDescription($data, $title),
                'canonical' => $canonical,
                'robots' => $indexable ? null : 'noindex',
                'image' => $image,
                'image_alt' => $title,
                'og_type' => 'article',
                'json_ld' => $this->vehicleJsonLd($data, $title, $canonical, $image, $showOwner ? $owner : null),
            ],
            'links' => [
                ...$this->appLinks('v/'.$vehicle->canonicalSlug()),
                'register' => url('/app/sign-up').'?next='.rawurlencode('/v/'.$vehicle->canonicalSlug()),
                'sign_in' => url('/app/sign-in').'?next='.rawurlencode('/v/'.$vehicle->canonicalSlug()),
                // [SIG sig.saved_builds] The hero's Speichern, as on VEH-01 for a guest: sign in first, then back to this build.
                'save' => app(FeatureFlags::class)->enabled('sig.saved_builds') ? url('/app/sign-in').'?next='.rawurlencode('/v/'.$vehicle->canonicalSlug()) : null,
            ],
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public function member(User $member, Request $request): array
    {
        $member->load(['avatar', 'cover']);

        $data = $this->resolve(new MemberProfileResource($member), $request);
        $vehicles = $member->vehicles()
            ->where('status', VehicleStatus::Published)
            ->where('visibility', Visibility::Public)
            ->with(VehicleCardResource::RELATIONS)
            ->withCount('modifications')
            ->orderByDesc('is_main')
            ->orderBy('sort')
            ->orderBy('id')
            ->limit(config()->integer('speedclub.garage.max_vehicles_per_member'))
            ->get();

        $name = is_string($data['display_name'] ?? null) && $data['display_name'] !== '' ? $data['display_name'] : '@'.$member->username;
        $canonical = url('/u/'.$member->username);

        return [
            'member' => $data,
            'vehicles' => $this->forcedEmpty($request) ? [] : $vehicles->map(fn (Vehicle $vehicle): array => $this->resolve(new VehicleCardResource($vehicle), $request))->all(),
            'seo' => [
                'title' => __('public.member.meta_title', ['name' => $name, 'username' => $member->username]),
                'description' => $this->excerpt($data['bio'] ?? null) ?? __('public.member.meta_description', ['name' => $name]),
                'canonical' => $canonical,
                'robots' => $member->getAttribute('indexable') === false ? 'noindex' : null,
                'image' => $this->og->forMember($member),
                'image_alt' => $name,
                'og_type' => 'profile',
                'json_ld' => [[
                    '@context' => 'https://schema.org',
                    '@type' => 'ProfilePage',
                    'url' => $canonical,
                    'mainEntity' => ['@type' => 'Person', 'name' => $name, 'alternateName' => '@'.$member->username, 'url' => $canonical],
                ]],
            ],
            // PROF-02 exists in the app since M2.1, so signing in comes back here and "In der App öffnen" is back (ADR-176 f).
            'links' => [
                ...$this->appLinks('u/'.$member->username),
                'register' => url('/app/sign-up').'?next='.rawurlencode('/u/'.$member->username),
                'sign_in' => url('/app/sign-in').'?next='.rawurlencode('/u/'.$member->username),
            ],
        ];
    }

    /**
     * ?qaState=empty outside production, for the screenshot matrix: the page's designed zero state.
     */
    private function forcedEmpty(Request $request): bool
    {
        return (PublicPageContext::qa($request)['state'] ?? null) === 'empty';
    }

    /**
     * "In der App öffnen": the app's own link when it is installed, the store otherwise (F4). Null until the store listing exists.
     *
     * @return array{web_app: string, deep_link: string, store_ios: string|null, store_android: string|null}
     */
    private function appLinks(string $path): array
    {
        $ios = config('speedclub.mobile.store_url_ios');
        $android = config('speedclub.mobile.store_url_android');

        return [
            'web_app' => url('/app/'.$path),
            'deep_link' => 'speedclub://'.$path,
            'store_ios' => is_string($ios) && $ios !== '' ? $ios : null,
            'store_android' => is_string($android) && $android !== '' ? $android : null,
        ];
    }

    /**
     * Nested resources become arrays only through a real JSON round trip; the page must not hold objects with lazy relations.
     *
     * @return array<string, mixed>
     */
    private function resolve(JsonResource $resource, Request $request): array
    {
        /** @var array<string, mixed> $data */
        $data = json_decode((string) json_encode($resource->resolve($request)), true);

        return $data;
    }

    /**
     * @param  array<string, mixed>  $data
     */
    private function vehicleDescription(array $data, string $title): string
    {
        $parts = is_array($data['subline_parts'] ?? null) ? implode(' · ', array_filter($data['subline_parts'], 'is_string')) : '';

        return $this->excerpt($data['description'] ?? null)
            ?? trim(__('public.vehicle.meta_description', ['title' => $title]).' '.$parts);
    }

    private function excerpt(mixed $text): ?string
    {
        if (! is_string($text) || trim($text) === '') {
            return null;
        }

        return mb_strimwidth(trim((string) preg_replace('/\s+/', ' ', $text)), 0, 160, '…');
    }

    /**
     * Vehicle + BreadcrumbList (05_ARCHITECTURE §18). Only what the page itself shows.
     *
     * @param  array<string, mixed>  $data
     * @return list<array<string, mixed>>
     */
    private function vehicleJsonLd(array $data, string $title, string $canonical, string $image, ?User $owner): array
    {
        $vehicle = array_filter([
            '@context' => 'https://schema.org',
            '@type' => 'Vehicle',
            'name' => $title,
            'url' => $canonical,
            'image' => $image,
            'description' => $data['description'] ?? null,
            'brand' => is_string($data['make'] ?? null) ? ['@type' => 'Brand', 'name' => $data['make']] : null,
            'model' => $data['model'] ?? null,
            'vehicleModelDate' => is_int($data['model_year'] ?? null) ? (string) $data['model_year'] : null,
            'color' => $data['color'] ?? null,
        ], fn (mixed $value): bool => $value !== null);

        $crumbs = [['name' => config()->string('app.name'), 'url' => url('/')]];

        if ($owner !== null && $owner->username !== null) {
            $crumbs[] = ['name' => '@'.$owner->username, 'url' => url('/u/'.$owner->username)];
        }

        $crumbs[] = ['name' => $title, 'url' => $canonical];

        return [$vehicle, [
            '@context' => 'https://schema.org',
            '@type' => 'BreadcrumbList',
            'itemListElement' => array_map(fn (array $crumb, int $index): array => [
                '@type' => 'ListItem',
                'position' => $index + 1,
                'name' => $crumb['name'],
                'item' => $crumb['url'],
            ], $crumbs, array_keys($crumbs)),
        ]];
    }
}
