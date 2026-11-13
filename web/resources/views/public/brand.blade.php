{{--
    WEB-11 /brands/{slug} (09 §7.11 BRD-01 as a public page, §9): the wordmark hero (display.title on a surface band; brands are set as
    text, never as logos), "about" from the catalogue, real counts, product lines, the parts with "In 14 Builds" and the "Builds mit
    {Marke}" wall. $brand holds BrandPageResource, $products ProductRowResources, $vehicles VehicleCards; $seo and $links from PartnerPages.
--}}
@php
    $builds = (int) $brand['builds'];
@endphp
<x-public.layout
    :title="$seo['title']"
    :description="$seo['description']"
    :robots="$seo['robots']"
    :canonical="$seo['canonical']"
    :image="$seo['image']"
    :image-square="$seo['image_square']"
    :image-alt="$seo['image_alt']"
    :og-type="$seo['og_type']"
    :json-ld="$seo['json_ld']"
    :auto-icons="true"
    display="marque"
>
    <x-public.top-bar :sign-in="$links['sign_in']" />

    <div class="flex-1">
        <main id="main" data-testid="WEB-11.root">
            <div class="sc-brand-band" data-testid="WEB-11.hero">
                <div class="sc-brand-band-inner">
                    <div class="sc-title-box"><x-public.display-title :text="$brand['name']" :name="false" class="text-ink" data-testid="WEB-11.name" /></div>
                    <p class="mt-8 text-callout text-ink-2" data-testid="WEB-11.counts">
                        <span class="tabular-nums text-ink">{{ \App\Support\Units::formatNumber($builds, app()->getLocale(), 0) }}</span>&nbsp;{{ trans_choice('public.brand.builds', $builds) }}
                        · <span class="tabular-nums text-ink">{{ \App\Support\Units::formatNumber((int) $brand['products'], app()->getLocale(), 0) }}</span>&nbsp;{{ trans_choice('public.brand.products_count', (int) $brand['products']) }}
                    </p>
                    @if ($brand['about'])
                        <p class="mt-16 text-body text-ink" data-testid="WEB-11.about">{{ $brand['about'] }}</p>
                    @endif
                    @if ($brand['website'])
                        <p class="mt-8 text-callout"><a href="{{ $brand['website'] }}" rel="noopener nofollow" class="sc-focus inline-flex min-h-44 items-center text-ink-2 underline" data-testid="WEB-11.website">{{ __('public.brand.website') }}</a></p>
                    @endif
                </div>
            </div>

            <div class="sc-member">
                <div class="sc-member-side">
                    @if ($brand['lines'] !== [])
                        <h2 class="text-callout-strong text-ink">{{ __('public.brand.lines') }}</h2>
                        <ul class="mt-8 flex flex-wrap gap-4" data-testid="WEB-11.lines">
                            @foreach ($brand['lines'] as $line)
                                <li class="inline-flex min-h-32 items-center gap-4 rounded-full bg-raised px-12 text-callout text-ink">{{ $line['name'] }} <span class="tabular-nums text-ink-3">{{ $line['products'] }}</span></li>
                            @endforeach
                        </ul>
                    @endif

                    @if ($products !== [])
                        <h2 class="mt-24 text-callout-strong text-ink">{{ __('public.brand.products') }}</h2>
                        <ul class="sc-rows mt-8" data-testid="WEB-11.products">
                            @foreach ($products as $product)
                                <li class="sc-row">
                                    <span class="min-w-0">
                                        <span class="block text-headline text-ink">{{ $product['name'] }}</span>
                                        <span class="block text-caption text-ink-2">{{ $product['category']['name'] }}</span>
                                    </span>
                                    <span class="text-caption tabular-nums text-ink-2 whitespace-nowrap">{{ trans_choice('public.brand.in_builds', (int) $product['builds'], ['count' => \App\Support\Units::formatNumber((int) $product['builds'], app()->getLocale(), 0)]) }}</span>
                                </li>
                            @endforeach
                        </ul>
                        @if ($more_products)
                            <p class="mt-8 text-callout"><a href="{{ $links['web_app'] }}" class="sc-focus inline-flex min-h-44 items-center text-ink-2 underline">{{ __('public.brand.more') }}</a></p>
                        @endif
                    @endif
                </div>

                <section class="sc-member-main" aria-labelledby="builds-title" data-testid="WEB-11.builds">
                    <x-public.section-header id="builds-title" level="h2" :title="__('public.brand.builds_title', ['name' => $brand['name']])" icon="part-box" />
                    @if ($vehicles === [])
                        <div class="sc-empty mt-12" data-testid="WEB-11.buildsEmpty">
                            <x-public.icon name="part-box" :size="48" class="text-ink-3" />
                            <p class="mt-12 text-headline text-ink">{{ __('public.brand.builds_empty', ['name' => $brand['name']]) }}</p>
                            <p class="mt-4 text-body text-ink-2">{{ __('public.brand.builds_empty_body', ['name' => $brand['name']]) }}</p>
                        </div>
                    @else
                        <ul class="sc-garage {{ count($vehicles) === 1 ? 'sc-garage-single' : '' }} mt-12">
                            @foreach ($vehicles as $card)
                                <li class="sc-garage-item"><x-public.vehicle-card :card="$card" testid="WEB-11.build" /></li>
                            @endforeach
                        </ul>
                    @endif
                </section>
            </div>
        </main>

        <x-public.sticky-cta :links="$links" />
    </div>
</x-public.layout>
