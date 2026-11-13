<?php

namespace App\Services\PublicPages;

use App\Http\Resources\V1\BrandPageResource;
use App\Http\Resources\V1\BusinessResource;
use App\Http\Resources\V1\ProductRowResource;
use App\Http\Resources\V1\VehicleCardResource;
use App\Models\Brand;
use App\Models\Business;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\Businesses\BusinessListing;
use App\Services\Parts\BrandPages;
use App\Services\Parts\PartBuilds;
use App\Services\Parts\ProductPresenter;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * The data of WEB-10 /b/{slug} and WEB-11 /brands/{slug} (09 §9, M4.14): the same resources as BIZ-01 and BRD-01, the first builds of
 * the portfolio or the brand wall as VehicleCards, SEO (title, description, canonical, OG image, JSON-LD) and the app links. A sample
 * business is noindex (09 §8.19).
 */
final class PartnerPages
{
    private const WALL = 6;

    public function __construct(
        private readonly BusinessListing $listing,
        private readonly BrandPages $brands,
        private readonly PartBuilds $builds,
        private readonly PartnerOgImages $og,
    ) {}

    /**
     * @return array<string, mixed>
     */
    public function business(Business $business, ?User $viewer, Request $request): array
    {
        $business->loadMissing(['owner', 'logo', 'cover']);
        $business->portfolioCount = $this->listing->portfolioCount($viewer, $business);
        $data = $this->resolve(new BusinessResource($business), $request);
        $vehicles = $this->cards($this->listing->portfolio($viewer, $business, self::WALL)->items(), $request);
        $canonical = url('/b/'.$business->slug);
        // M4.16: the drawn card (cover, name, kind and city, the confirmed builds), the brand card while a guest may not see it.
        $images = $this->og->cards($business);
        $image = $images['landscape'];
        $line = $data['subline'];
        $description = mb_strimwidth(trim(implode(' · ', array_filter([$line, implode(', ', array_slice($data['services'], 0, 4))]))).'. '.__('public.business.meta_cta'), 0, 160, '…');

        return [
            'business' => $data,
            'vehicles' => $vehicles,
            'seo' => [
                'title' => __('public.business.meta_title', ['name' => $business->name, 'city' => $business->city]),
                'description' => $description,
                'canonical' => $canonical,
                'robots' => $business->is_sample ? 'noindex' : null,
                'image' => $image,
                'image_square' => $images['square'],
                'image_alt' => $business->name,
                'og_type' => 'website',
                'json_ld' => [array_filter([
                    '@context' => 'https://schema.org',
                    '@type' => 'AutoRepair',
                    'name' => $business->name,
                    'legalName' => $business->legal_name,
                    'url' => $canonical,
                    'image' => $image,
                    'email' => $business->email,
                    'telephone' => $business->phone,
                    'sameAs' => $business->website,
                    'address' => [
                        '@type' => 'PostalAddress',
                        'streetAddress' => $business->street,
                        'postalCode' => $business->postcode,
                        'addressLocality' => $business->city,
                        'addressCountry' => $business->country,
                    ],
                    'geo' => $business->lat !== null && $business->lng !== null ? ['@type' => 'GeoCoordinates', 'latitude' => $business->lat, 'longitude' => $business->lng] : null,
                ], fn (mixed $value): bool => $value !== null)],
            ],
            'links' => self::links('b/'.$business->slug),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public function brand(Brand $brand, ?User $viewer, Request $request): array
    {
        $page = $this->brands->page($viewer, $brand);
        $data = $this->resolve(new BrandPageResource($page), $request);
        $products = $this->brands->products($brand, 12);
        app(ProductPresenter::class)->prepare($products->items(), $viewer);
        $canonical = url('/brands/'.$brand->slug);
        $images = $this->og->cards($brand);
        $about = is_string($data['about']) ? $data['about'].' ' : '';

        return [
            'brand' => $data,
            'products' => array_map(fn ($product): array => $this->resolve(new ProductRowResource($product), $request), $products->items()),
            'more_products' => $products->hasMorePages(),
            'vehicles' => $this->cards($this->builds->forBrand($viewer, $brand, self::WALL)->items(), $request),
            'seo' => [
                'title' => __('public.brand.meta_title', ['name' => $brand->name]),
                'description' => mb_strimwidth($about.__('public.brand.meta_description', ['name' => $brand->name]), 0, 160, '…'),
                'canonical' => $canonical,
                'robots' => null,
                'image' => $images['landscape'],
                'image_square' => $images['square'],
                'image_alt' => $brand->name,
                'og_type' => 'website',
                'json_ld' => [array_filter([
                    '@context' => 'https://schema.org',
                    '@type' => 'Brand',
                    'name' => $brand->name,
                    'url' => $canonical,
                    'sameAs' => $brand->website,
                    'description' => is_string($data['about']) ? $data['about'] : null,
                ], fn (mixed $value): bool => $value !== null)],
            ],
            'links' => self::links('brands/'.$brand->slug),
        ];
    }

    /**
     * @param  array<int, Vehicle>  $vehicles
     * @return list<array<string, mixed>>
     */
    private function cards(array $vehicles, Request $request): array
    {
        $cards = [];

        foreach ($vehicles as $vehicle) {
            $vehicle->loadMissing(VehicleCardResource::RELATIONS);
            $cards[] = $this->resolve(new VehicleCardResource($vehicle), $request);
        }

        return $cards;
    }

    /**
     * The app links of a public page. `$appPath` where the app's route differs from the public path (/e/{slug} → events/{slug}).
     *
     * @return array{web_app: string, deep_link: string, store_ios: string|null, store_android: string|null, register: string, sign_in: string}
     */
    public static function links(string $path, ?string $appPath = null): array
    {
        $ios = config('speedclub.mobile.store_url_ios');
        $android = config('speedclub.mobile.store_url_android');

        return [
            'web_app' => url('/app/'.($appPath ?? $path)),
            'deep_link' => 'speedclub://'.($appPath ?? $path),
            'store_ios' => is_string($ios) && $ios !== '' ? $ios : null,
            'store_android' => is_string($android) && $android !== '' ? $android : null,
            'register' => url('/app/sign-up').'?next='.rawurlencode('/'.($appPath ?? $path)),
            'sign_in' => url('/app/sign-in').'?next='.rawurlencode('/'.($appPath ?? $path)),
        ];
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
}
