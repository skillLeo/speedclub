{{--
    WEB-15 /brands/{slug} (09 §7.11 BRD-01 as a public page, §9; ADR-457, DQ-1166/1167). Photo first: the lead photo (the newest real
    build with the brand's most-used product, `lead_photo`) 16:9 as the hero with the wordmark (display.title, Archivo SemiExpanded; brands
    are set as text, never as logos) on scrim.photo and "Beispiel" on a sample build. Without one the wordmark sits on the surface band.
    Under it the real counts (samples never counted), "about", product lines, the parts with a 48 thumbnail from a real build that uses
    them (no tile otherwise, DQ-1167) and "In 14 Builds" — parts without a real build follow under "Weitere Teile", without a count —
    and the "Builds mit {Marke}" wall (real builds first, samples badged). $brand holds BrandPageResource, $products ProductRowResources,
    $vehicles VehicleCards; $seo and $links from PartnerPages.
--}}
@php
    $builds = (int) $brand['builds'];
    $lead = is_array($brand['lead_photo'] ?? null) && ($brand['lead_photo']['photo']['variants'] ?? []) !== [] ? $brand['lead_photo'] : null;
    $used = array_values(array_filter($products, fn (array $product): bool => (int) $product['builds'] > 0));
    $unused = array_values(array_filter($products, fn (array $product): bool => (int) $product['builds'] === 0));
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
        <main id="main" data-testid="WEB-15.root">
            @if ($lead)
                <div class="sc-brand-stage" data-testid="WEB-15.hero">
                    <div class="sc-brand-photo" data-qa-exempt="photo" data-testid="WEB-15.leadPhoto">
                        <x-public.photo :photo="$lead['photo']" sizes="(min-width: 1280px) 1200px, 100vw" :priority="true" :alt="($lead['photo']['alt'] ?? null) ?: $lead['vehicle']['full_title']" class="h-full w-full object-cover" />
                        <span class="sc-hero-scrim" aria-hidden="true"></span>
                        @if ($lead['vehicle']['is_sample'])
                            <span class="sc-brand-badges"><x-public.sample-badges :sample="true" :on-photo="true" testid="WEB-15.leadSample" /></span>
                        @endif
                    </div>
                    <div class="sc-brand-identity sc-title-box"><x-public.display-title :text="$brand['name']" :name="false" class="text-on-photo" data-testid="WEB-15.name" /></div>
                </div>
            @endif
            <div @class(['sc-brand-band', 'is-under-photo' => $lead !== null]) @if (! $lead) data-testid="WEB-15.hero" @endif>
                <div class="sc-brand-band-inner">
                    @unless ($lead)
                        <div class="sc-title-box"><x-public.display-title :text="$brand['name']" :name="false" class="text-ink" data-testid="WEB-15.name" /></div>
                    @endunless
                    {{-- ADR-457: real builds only; no "0 Builds" while only samples carry the brand. --}}
                    <p @class(['text-callout text-ink-2', 'mt-8' => ! $lead]) data-testid="WEB-15.counts">
                        @if ($builds > 0)
                            <span class="sc-keep"><span class="tabular-nums text-ink">{{ \App\Support\Units::formatNumber($builds, app()->getLocale(), 0) }}</span>&nbsp;{{ trans_choice('public.brand.builds', $builds) }}&nbsp;·</span>
                        @endif
                        <span class="sc-keep"><span class="tabular-nums text-ink">{{ \App\Support\Units::formatNumber((int) $brand['products'], app()->getLocale(), 0) }}</span>&nbsp;{{ trans_choice('public.brand.products_count', (int) $brand['products']) }}</span>
                    </p>
                    @if ($brand['about'])
                        <p class="mt-16 text-body text-ink" data-testid="WEB-15.about">{{ $brand['about'] }}</p>
                    @endif
                    @if ($brand['website'])
                        <p class="mt-8 text-callout"><a href="{{ $brand['website'] }}" rel="noopener nofollow" class="sc-focus inline-flex min-h-44 items-center text-ink-2 underline" data-testid="WEB-15.website">{{ __('public.brand.website') }}</a></p>
                    @endif
                    @if ($lead)
                        <p class="mt-8 text-caption text-ink-2" data-testid="WEB-15.leadCredit">{{ __('public.brand.lead_credit') }} <a href="{{ \App\Support\PublicUrl::to($lead['vehicle']['path']) }}" class="sc-focus inline-flex min-h-44 items-center text-ink underline"><span>{{ \App\Support\KeepTogether::name($lead['vehicle']['full_title']) }}</span></a></p>
                    @endif
                </div>
            </div>

            <div class="sc-member">
                <div class="sc-member-side">
                    @if ($brand['lines'] !== [])
                        <h2 class="text-callout-strong text-ink">{{ __('public.brand.lines') }}</h2>
                        <ul class="mt-8 flex flex-wrap gap-4" data-testid="WEB-15.lines">
                            @foreach ($brand['lines'] as $line)
                                <li class="inline-flex min-h-32 items-center gap-4 rounded-full bg-raised px-12 text-callout text-ink">{{ $line['name'] }} <span class="tabular-nums text-ink-3">{{ $line['products'] }}</span></li>
                            @endforeach
                        </ul>
                    @endif

                    @if ($products !== [])
                        <h2 class="mt-24 text-callout-strong text-ink">{{ __('public.brand.products') }}</h2>
                        @if ($used !== [])
                            <ul class="sc-rows mt-8" data-testid="WEB-15.products">
                                @foreach ($used as $product)
                                    @include('public.partials.product-row', ['product' => $product, 'count' => true])
                                @endforeach
                            </ul>
                        @endif
                        @if ($unused !== [])
                            @if ($used !== [])
                                <h3 class="sc-rows-more mt-16 text-callout text-ink-2" data-testid="WEB-15.moreParts">{{ __('public.brand.more_parts') }}</h3>
                            @endif
                            <ul class="sc-rows mt-8" data-testid="WEB-15.otherProducts">
                                @foreach ($unused as $product)
                                    @include('public.partials.product-row', ['product' => $product, 'count' => false])
                                @endforeach
                            </ul>
                        @endif
                        @if ($more_products)
                            <p class="mt-8 text-callout"><a href="{{ $links['web_app'] }}" class="sc-focus inline-flex min-h-44 items-center text-ink-2 underline">{{ __('public.brand.more') }}</a></p>
                        @endif
                    @endif
                </div>

                <section class="sc-member-main" aria-labelledby="builds-title" data-testid="WEB-15.builds">
                    <x-public.section-header id="builds-title" level="h2" :title="__('public.brand.builds_title', ['name' => $brand['name']])" icon="part-box" />
                    @if ($vehicles === [])
                        <div class="sc-empty mt-12" data-testid="WEB-15.buildsEmpty">
                            <x-public.icon name="part-box" :size="48" class="text-ink-3" />
                            <p class="mt-12 text-headline text-ink">{{ __('public.brand.builds_empty', ['name' => $brand['name']]) }}</p>
                            <p class="mt-4 text-body text-ink-2">{{ __('public.brand.builds_empty_body', ['name' => $brand['name']]) }}</p>
                        </div>
                    @else
                        <ul class="sc-garage {{ count($vehicles) === 1 ? 'sc-garage-single' : '' }} mt-12">
                            @foreach ($vehicles as $card)
                                <li class="sc-garage-item"><x-public.vehicle-card :card="$card" testid="WEB-15.build" /></li>
                            @endforeach
                        </ul>
                    @endif
                </section>
            </div>
        </main>

        <x-public.sticky-cta :links="$links" />
    </div>
</x-public.layout>
