{{--
    WEB-03 Landing ★ (09 §9, M4.16). Not a centred hero with a pill and two buttons: (1) a full-bleed night photo (88 svh on phones), the
    claim left-aligned in display.title from the text-safe line down onto the dark stage, one line, "Zur Web-App" (the one filled CTA) and
    the text link to the QR story; (2) the QR story in three real steps, each with a crop of the real UI (the lead build's spec strip, its
    mod rows, its sticker code), no device mock-ups; (3) featured builds as an editorial grid (8 + 4 + 4), real or Beispiel-badged;
    (4) the next three meets while `events` is on and there are any, the workshop teaser while `businesses` is on; (5) store links only
    when they exist. Nothing invented: on an empty database the sections without content are simply not there.
--}}
@php
    $hero = \App\Services\PublicPages\PublicPhoto::brand('landing-hero');
    $wheel = \App\Services\PublicPages\PublicPhoto::brand('landing-wheel');
    $taillight = \App\Services\PublicPages\PublicPhoto::brand('landing-taillight');
    $station = \App\Services\PublicPages\PublicPhoto::brand('landing-station');
    $vehicle = $featured['vehicle'] ?? null;
    $featuredPhoto = $vehicle['photos'][0] ?? null;
    $owner = $vehicle['owner'] ?? null;
    $stepSizes = '(min-width: 1280px) 688px, (min-width: 768px) 58vw, 100vw';
    $stores = array_filter(['App Store' => $store_ios, 'Google Play' => $store_android]);
    $json = [[
        '@context' => 'https://schema.org',
        '@type' => 'Organization',
        '@id' => $canonical.'#organization',
        'name' => config('app.name'),
        'url' => $canonical,
        'logo' => url('/brand/logo-wide-black-1280.png'),
        'slogan' => __('public.home.claim', [], 'de'),
    ], [
        '@context' => 'https://schema.org',
        '@type' => 'WebSite',
        '@id' => $canonical.'#website',
        'name' => config('app.name'),
        'url' => $canonical,
        'description' => __('public.home.description'),
        'inLanguage' => ['de-DE', 'en-GB'],
        'publisher' => ['@id' => $canonical.'#organization'],
    ]];
@endphp
<x-public.layout :title="__('public.home.title')" :description="__('public.home.description')" :canonical="$canonical" :json-ld="$json" :auto-icons="true" display="marque">
    <x-public.top-bar />

    <main id="main" class="flex-1" data-testid="WEB-03.root">
        {{-- (1) The photo fades into its dark stage (scrim.photo); the claim starts at the text-safe line and every further line, at any
             text size, flows onto the stage below the photo (ADR-421 b, DQ-917). The stage is dark in every theme. --}}
        <section class="sc-land-hero" aria-labelledby="claim" data-testid="WEB-03.hero">
            <div class="sc-land-hero-media sc-grain" data-qa-exempt="photo">
                <x-public.photo :photo="$hero" sizes="100vw" :priority="true" alt="" class="h-full w-full object-cover" />
                <span class="sc-hero-scrim" aria-hidden="true"></span>
            </div>
            <div class="sc-land-hero-inner">
                {{-- The title box is the 640 measure itself, so the title's size rule counts the lines it really gets (ADR-426 a). --}}
                <div class="sc-title-box">
                    <x-public.display-title :text="__('public.home.claim')" :name="false" id="claim" class="text-on-photo" data-testid="WEB-03.claim" />
                </div>
                <p class="mt-8 text-body text-on-photo" data-testid="WEB-03.lead">{{ __('public.home.lead') }}</p>
                <div class="mt-24 flex flex-wrap items-center gap-x-16 gap-y-8">
                    <x-public.button :href="url('/app')" variant="brand" size="l" data-testid="WEB-03.openWebApp">{{ __('public.home.web_app') }}</x-public.button>
                    <a href="#qr" class="sc-focus inline-flex min-h-44 items-center gap-4 rounded-xs text-body-strong text-on-photo underline underline-offset-4" data-testid="WEB-03.howQr">{{ __('public.home.how_qr') }}</a>
                </div>
            </div>
        </section>

        {{-- (2) The QR story. Each step shows a piece of the real interface with real data, set like the app sets it. --}}
        <section id="qr" class="sc-steps" aria-labelledby="steps-title" data-testid="WEB-03.steps">
            <div class="sc-steps-head">
                <span class="sc-rule" aria-hidden="true"></span>
                <h2 id="steps-title" class="mt-16 t-title-1 text-ink">{{ __('public.home.how_qr') }}</h2>
                <p class="mt-12 text-body text-ink-2">{{ __('public.home.thought_body') }}</p>
            </div>

            <article class="sc-step sc-step-photo-left" data-testid="WEB-03.step1">
                <div class="sc-step-media" data-qa-exempt="photo"><x-public.photo :photo="$wheel" :sizes="$stepSizes" class="h-full w-full object-cover" /></div>
                <div class="sc-step-copy">
                    <p class="t-hero-numeral-s text-ink-3" aria-hidden="true">1</p>
                    <h3 class="mt-4 t-title-2 text-ink">{{ __('public.home.step1_title') }}</h3>
                    <p class="mt-8 text-body text-ink-2">{{ __('public.home.step1_body') }}</p>
                    @if ($vehicle && $vehicle['spec_strip'] !== [])
                        <figure class="sc-crop mt-16" data-testid="WEB-03.crop1">
                            <p class="text-headline text-ink">{{ \App\Support\KeepTogether::name($vehicle['full_title']) }}</p>
                            <div class="mt-8"><x-public.spec-strip :items="$vehicle['spec_strip']" :groups="$vehicle['spec_groups'] ?? []" testid="WEB-03.cropStrip" /></div>
                            <figcaption class="mt-8 flex flex-wrap items-center gap-8 text-caption text-ink-3">
                                <span>{{ $owner ? __('public.home.crop_from', ['username' => $owner['username']]) : __('public.home.crop_build') }}</span>
                                <x-public.sample-badges :sample="($vehicle['is_sample'] ?? false) === true" testid="WEB-03.crop1Sample" />
                            </figcaption>
                        </figure>
                    @endif
                </div>
            </article>

            <article class="sc-step sc-step-photo-right" data-testid="WEB-03.step2">
                <div class="sc-step-media" data-qa-exempt="photo"><x-public.photo :photo="$station" :sizes="$stepSizes" class="h-full w-full object-cover" /></div>
                <div class="sc-step-copy">
                    <p class="t-hero-numeral-s text-ink-3" aria-hidden="true">2</p>
                    <h3 class="mt-4 t-title-2 text-ink">{{ __('public.home.step2_title') }}</h3>
                    <p class="mt-8 text-body text-ink-2">{{ __('public.home.step2_body') }}</p>
                    @if ($vehicle && ($vehicle['highlights'] ?? []) !== [])
                        <ul class="sc-group mt-16" aria-label="{{ __('public.home.step2_example') }}" data-testid="WEB-03.crop2">
                            @foreach (array_slice($vehicle['highlights'], 0, 3) as $mod)
                                <x-public.mod-row :mod="$mod" />
                            @endforeach
                        </ul>
                    @endif
                </div>
            </article>

            <article class="sc-step sc-step-qr" data-testid="WEB-03.step3">
                <div class="sc-step-copy">
                    <p class="t-hero-numeral-s text-ink-3" aria-hidden="true">3</p>
                    <h3 class="mt-4 t-title-2 text-ink">{{ __('public.home.step3_title') }}</h3>
                    <p class="mt-8 text-body text-ink-2">{{ __('public.home.step3_body') }}</p>
                    @if ($qr)
                        <p class="mt-12 text-callout text-ink-2">{{ __('public.home.step3_try') }}</p>
                    @endif
                </div>
                <div class="sc-step-stage" data-qa-exempt="photo">
                    <x-public.photo :photo="$taillight" :sizes="$stepSizes" class="sc-step-stage-img" />
                    @if ($qr)
                        <figure class="sc-qr" data-testid="WEB-03.qr" data-qa-exempt="qr">
                            <a href="{{ $qr['url'] }}" class="sc-focus sc-qr-code block" aria-label="{{ __('public.home.qr_label', ['code' => $qr['code']]) }}">{{ $qr['svg'] }}</a>
                            <figcaption class="mt-8 text-center">
                                <span class="block text-headline uppercase tabular-nums text-qr-fg">{{ $qr['code'] }}</span>
                            </figcaption>
                        </figure>
                    @endif
                </div>
            </article>
        </section>

        {{-- (3) Featured builds: one 8-column lead with its name on the scrim, two 4-column cards beside it (stacked under it on phones). --}}
        @if ($vehicle && $featuredPhoto)
            <section class="sc-builds" aria-labelledby="builds-title" data-testid="WEB-03.featured">
                <h2 id="builds-title" class="sc-builds-title t-title-2 text-ink">{{ __('public.home.featured_title') }}</h2>
                <div class="sc-builds-grid {{ $more === [] ? 'is-single' : '' }}">
                    <div class="sc-builds-lead">
                        <a href="{{ \App\Support\PublicUrl::to('/v/'.$vehicle['slug']) }}" class="sc-focus sc-lead-link" data-qa-exempt="photo" data-testid="WEB-03.featuredLink">
                            <x-public.photo :photo="$featuredPhoto" sizes="(min-width: 1280px) 816px, 100vw" :alt="$featuredPhoto['alt'] ?: $vehicle['full_title']" class="absolute inset-0 h-full w-full object-cover" />
                            <span class="sc-hero-scrim" aria-hidden="true"></span>
                            <span class="sc-lead-text sc-title-box">
                                @if ($vehicle['is_sample'] ?? false)
                                    <x-public.sample-badges :sample="true" :editorial="($owner['is_editorial'] ?? false) === true" :on-photo="true" class="mb-8" testid="WEB-03.featuredSample" />
                                @endif
                                {{-- ADR-426 b: edge to edge on a phone (4:5, a hero) the page rule; in the rounded 16:9 lead of the grid from 768 the card rule. --}}
                                <x-public.display-title as="span" :text="$vehicle['full_title']" :placement="['phone' => 'page', 'tablet' => 'card', 'desktop' => 'card']" class="block text-on-photo" data-testid="WEB-03.featuredTitle" />
                                @if ($owner)
                                    <span class="mt-4 block text-callout text-on-photo">{{ \App\Support\KeepTogether::identifier('@'.$owner['username']) }}{{ $owner['city'] ? ' · '.$owner['city'] : '' }}</span>
                                @endif
                            </span>
                        </a>
                        <div class="mt-16"><x-public.spec-strip :items="$vehicle['spec_strip']" :groups="$vehicle['spec_groups'] ?? []" testid="WEB-03.featuredStrip" /></div>
                        <x-public.button :href="\App\Support\PublicUrl::to('/v/'.$vehicle['slug'])" variant="secondary" size="m" class="mt-16" data-testid="WEB-03.featuredCta">{{ __('public.home.featured_cta') }} <x-public.icon name="arrow-right" :size="20" /></x-public.button>
                    </div>
                    @foreach ($more as $card)
                        <div class="sc-builds-side"><x-public.vehicle-card :card="$card" sizes="(min-width: 1280px) 400px, (min-width: 768px) 50vw, 100vw" testid="WEB-03.build" /></div>
                    @endforeach
                </div>
            </section>
        @endif

        {{-- (4) Treffen teaser: the next three public meets, with their real dates. --}}
        @if ($events !== [])
            <section class="sc-land-section" aria-labelledby="events-title" data-testid="WEB-03.events">
                <x-public.section-header id="events-title" level="h2" :title="__('public.home.events_title')" :href="url('/app/events')" :action="__('public.home.events_all')" />
                <ul class="sc-rows mt-12">
                    @foreach ($events as $item)
                        @php
                            $starts = \Carbon\CarbonImmutable::parse($item['starts_at'])->timezone($item['timezone'])->locale(app()->getLocale());
                        @endphp
                        <li>
                            <a href="{{ \App\Support\PublicUrl::to('/e/'.$item['slug']) }}" class="sc-focus sc-row sc-event-row justify-start" data-testid="WEB-03.event">
                                <time datetime="{{ $starts->toIso8601String() }}" class="sc-evt-date">
                                    <span class="t-hero-numeral-s text-ink">{{ $starts->isoFormat('D') }}</span>
                                    <span class="t-label-caps text-ink-2">{{ rtrim($starts->isoFormat('MMM'), '.') }}</span>
                                </time>
                                <span class="min-w-0 flex-1">
                                    <span class="block text-headline text-ink">{{ \App\Support\KeepTogether::words($item['title']) }}</span>
                                    <span class="block text-callout text-ink-2">{{ __('enums.event_type.'.$item['type']) }} · {{ $item['location']['city'] }} · <span class="tabular-nums">{{ __('public.event.time_from', ['from' => $starts->format('H:i')]) }}</span></span>
                                    @if ($item['is_sample'])
                                        <x-public.sample-badges :sample="true" class="mt-4" testid="WEB-03.eventSample" />
                                    @endif
                                </span>
                                <x-public.icon name="caret-right" :size="20" class="text-ink-3" />
                            </a>
                        </li>
                    @endforeach
                </ul>
            </section>
        @endif

        @if ($businesses)
            <section class="sc-land-section sc-land-business" aria-labelledby="business-title" data-testid="WEB-03.business">
                <div>
                    <h2 id="business-title" class="flex items-center gap-8 t-title-2 text-ink"><x-public.icon name="workshop" :size="24" class="text-ink-2" />{{ __('public.home.business_title') }}</h2>
                    <p class="mt-8 text-body text-ink-2">{{ __('public.home.business_body') }}</p>
                </div>
                <x-public.button :href="url('/app/settings/business')" variant="secondary" size="l" data-testid="WEB-03.businessCta">{{ __('public.home.business_cta') }}</x-public.button>
            </section>
        @endif

        {{-- (5) Honest: store links only once the listings exist; until then the web app, which is real today. --}}
        <section id="app" class="sc-land-section sc-land-app" aria-labelledby="app-title" data-testid="WEB-03.app">
            <div>
                <h2 id="app-title" class="t-title-2 text-ink">{{ $stores === [] ? __('public.home.app_title') : __('public.home.app_title_stores') }}</h2>
                <p class="mt-8 text-body text-ink-2">{{ $stores === [] ? __('public.home.app_body') : __('public.home.app_body_stores') }}</p>
            </div>
            <div class="flex flex-wrap gap-8" data-testid="WEB-03.stores">
                @foreach ($stores as $store => $url)
                    <x-public.button :href="$url" variant="secondary" size="l" data-testid="WEB-03.store"><x-public.icon name="device-mobile" :size="20" /><span class="whitespace-nowrap hyphens-none">{{ $store }}</span></x-public.button>
                @endforeach
                <x-public.button :href="url('/app')" variant="secondary" size="l" data-testid="WEB-03.browser">{{ __('public.home.open_app') }}</x-public.button>
            </div>
        </section>
    </main>
</x-public.layout>
