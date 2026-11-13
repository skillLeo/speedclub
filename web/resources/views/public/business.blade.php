{{--
    WEB-10 /b/{slug} (09 §7.11 BIZ-01 ★ as a public page, §9). $business holds BusinessResource, $vehicles the first VehicleCards of the
    portfolio ("Builds aus unserer Werkstatt": both sides confirmed), $seo and $links from App\Services\PublicPages\PartnerPages. Readable
    without JavaScript. The Impressum block (§ 5 DDG) closes the page; a sample business says its data is a placeholder (09 §8.19).
--}}
@php
    $cover = ($business['cover']['variants'] ?? []) !== [] ? $business['cover'] : null;
    $logo = ($business['logo']['variants'] ?? []) !== [] ? $business['logo'] : null;
    $sample = ($business['is_sample'] ?? false) === true;
    $impressum = $business['impressum'];
    $address = $business['address'];
    $contact = $business['contact'];
    $route = $address['lat'] !== null && $address['lng'] !== null
        ? 'https://www.openstreetmap.org/directions?to='.$address['lat'].'%2C'.$address['lng']
        : 'https://www.openstreetmap.org/search?query='.rawurlencode($address['street'].', '.$address['postcode'].' '.$address['city']);
    $message = $contact['message_username'] !== null ? url('/app/u/'.$contact['message_username']) : null;
    $register = array_filter([$impressum['register_court'], $impressum['register_number']]);
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
>
    <x-public.top-bar :sign-in="$links['sign_in']" />

    <div class="flex-1">
        <main id="main" data-testid="WEB-10.root">
            @if ($cover)
                <div class="sc-biz-cover" data-testid="WEB-10.cover" data-qa-exempt="photo">
                    <x-public.photo :photo="$cover" sizes="(min-width: 1280px) 1248px, 100vw" :alt="$cover['alt'] ?? ''" :priority="true" class="h-full w-full object-cover" />
                </div>
            @endif

            <div class="sc-member">
                <div class="sc-member-side" data-testid="WEB-10.header">
                    <div class="flex items-center gap-12">
                        <span class="sc-biz-logo inline-flex items-center justify-center text-ink-2" data-testid="WEB-10.logo">
                            @if ($logo)
                                <x-public.photo :photo="$logo" sizes="56px" :alt="''" class="h-full w-full object-cover" />
                            @else
                                <x-public.icon name="workshop" :size="24" />
                            @endif
                        </span>
                        <div class="min-w-0">
                            <h1 class="t-title-1 text-ink" data-testid="WEB-10.name">{{ \App\Support\KeepTogether::words($business['name']) }}</h1>
                            <p class="text-callout text-ink-2" data-testid="WEB-10.subline">{{ $business['subline'] }}</p>
                        </div>
                    </div>
                    <div class="mt-12 flex flex-wrap gap-4">
                        @if ($business['verified'])
                            <x-public.status-pill :label="__('public.business.verified')" data-testid="WEB-10.verified" />
                        @endif
                        <x-public.sample-badges :sample="$sample" testid="WEB-10.sample" />
                    </div>

                    @if ($business['about'])
                        <p class="mt-16 whitespace-pre-line text-body text-ink" data-testid="WEB-10.about">{{ $business['about'] }}</p>
                    @endif

                    @if ($business['services'] !== [])
                        <h2 class="mt-24 text-callout-strong text-ink">{{ __('public.business.services') }}</h2>
                        <ul class="mt-8 flex flex-wrap gap-4" data-testid="WEB-10.services">
                            @foreach ($business['services'] as $service)
                                <li class="inline-flex min-h-32 items-center rounded-full bg-raised px-12 text-callout text-ink">{{ $service }}</li>
                            @endforeach
                        </ul>
                    @endif

                    <div class="mt-24 flex flex-wrap gap-8" data-testid="WEB-10.actions">
                        @if ($message)
                            <x-public.button :href="$links['sign_in']" variant="secondary" data-testid="WEB-10.message">{{ __('public.business.message') }}</x-public.button>
                        @endif
                        @if ($contact['phone'])
                            <x-public.button :href="'tel:'.preg_replace('/[^0-9+]/', '', $contact['phone'])" variant="secondary" data-testid="WEB-10.call">{{ __('public.business.call') }}</x-public.button>
                        @endif
                        <x-public.button :href="$route" variant="secondary" data-testid="WEB-10.route">{{ __('public.business.route') }}</x-public.button>
                    </div>

                    <h2 class="mt-24 text-callout-strong text-ink">{{ __('public.business.hours') }}</h2>
                    <dl class="sc-hours mt-8 text-callout text-ink-2" data-testid="WEB-10.hours">
                        @foreach ($business['opening_hours'] as $day)
                            <dt class="{{ $day['today'] ? 'sc-hours-today' : '' }}">{{ __('public.business.days.'.$day['day']) }}</dt>
                            <dd class="tabular-nums {{ $day['today'] ? 'sc-hours-today' : '' }}" @if ($day['today']) data-testid="WEB-10.today" @endif>
                                @if ($day['ranges'] === [])
                                    {{ __('public.business.closed') }}
                                @else
                                    {{ implode(', ', array_map(fn (array $range): string => $range['opens'].'–'.$range['closes'], $day['ranges'])) }}
                                @endif
                            </dd>
                        @endforeach
                    </dl>

                    <h2 class="mt-24 text-callout-strong text-ink">{{ __('public.business.address') }}</h2>
                    <address class="mt-8 not-italic text-body text-ink" data-testid="WEB-10.address">{{ $address['street'] }}<br>{{ $address['postcode'] }} {{ $address['city'] }}</address>
                    @if ($contact['website'])
                        <p class="mt-8 text-callout"><a href="{{ $contact['website'] }}" rel="noopener nofollow" class="sc-focus inline-flex min-h-44 items-center text-ink underline" data-testid="WEB-10.website">{{ __('public.business.website') }}</a></p>
                    @endif
                </div>

                <div class="sc-member-main">
                    <section aria-labelledby="portfolio-title" data-testid="WEB-10.portfolio">
                        <x-public.section-header id="portfolio-title" level="h2" :title="__('public.business.portfolio')" :count="$business['portfolio_count']" icon="garage-bay" />
                        @if ($vehicles === [])
                            <div class="sc-empty mt-12" data-testid="WEB-10.portfolioEmpty">
                                <x-public.icon name="workshop" :size="48" class="text-ink-3" />
                                <p class="mt-12 text-headline text-ink">{{ __('public.business.portfolio_empty') }}</p>
                                <p class="mt-4 text-body text-ink-2">{{ __('public.business.portfolio_empty_body') }}</p>
                            </div>
                        @else
                            <ul class="sc-garage {{ count($vehicles) === 1 ? 'sc-garage-single' : '' }} mt-12">
                                @foreach ($vehicles as $card)
                                    <li class="sc-garage-item"><x-public.vehicle-card :card="$card" testid="WEB-10.build" /></li>
                                @endforeach
                            </ul>
                        @endif
                    </section>

                    <section class="sc-impressum mt-32" aria-labelledby="impressum-title" data-testid="WEB-10.impressum">
                        <h2 id="impressum-title" class="text-headline text-ink">{{ __('public.business.impressum') }}</h2>
                        @if ($impressum['is_sample'])
                            <p class="mt-8 text-caption text-ink-3" data-testid="WEB-10.impressumSample">{{ __('public.business.impressum_sample') }}</p>
                        @endif
                        <p class="mt-12 text-body text-ink">{{ $impressum['legal_name'] }}<br>{{ $impressum['street'] }}<br>{{ $impressum['postcode'] }} {{ $impressum['city'] }}</p>
                        <dl class="sc-facts mt-12 text-callout text-ink">
                            <dt>{{ __('public.business.impressum_legal_form') }}</dt><dd>{{ $impressum['legal_form_label'] }}</dd>
                            @if ($impressum['representative'])
                                <dt>{{ __('public.business.impressum_representative') }}</dt><dd>{{ $impressum['representative'] }}</dd>
                            @endif
                            <dt>{{ __('public.business.impressum_email') }}</dt><dd><a href="mailto:{{ $impressum['email'] }}" class="sc-focus inline-flex min-h-44 items-center underline">{{ $impressum['email'] }}</a></dd>
                            @if ($impressum['phone'])
                                <dt>{{ __('public.business.impressum_phone') }}</dt><dd class="tabular-nums">{{ $impressum['phone'] }}</dd>
                            @endif
                            @if ($register !== [])
                                <dt>{{ __('public.business.impressum_register') }}</dt><dd>{{ implode(', ', $register) }}</dd>
                            @endif
                            @if ($impressum['vat_id'])
                                <dt>{{ __('public.business.impressum_vat') }}</dt><dd class="tabular-nums">{{ $impressum['vat_id'] }}</dd>
                            @endif
                        </dl>
                        <p class="mt-16 text-caption"><a href="{{ \App\Support\PublicUrl::to('/melden') }}" class="sc-focus inline-flex min-h-44 items-center text-ink-2 underline" data-testid="WEB-10.report">{{ __('public.business.report') }}</a></p>
                    </section>
                </div>
            </div>
        </main>

        <x-public.sticky-cta :links="$links" />
    </div>
</x-public.layout>
