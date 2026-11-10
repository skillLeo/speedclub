{{--
    WEB-03, brand layer (03_DESIGN_SYSTEM §2, §15): a night photo, the client's wordmark, the sticker's story in three real steps with a real code that leads to the real build
    below it. Left-aligned, with a different module per section. No fake numbers and no fake store links: $featured and $qr are null on an empty database, and the page still reads.
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
    $json = [[
        '@context' => 'https://schema.org',
        '@type' => 'Organization',
        'name' => config('app.name'),
        'url' => $canonical,
        'logo' => url('/brand/logo-wide-black-1280.png'),
        'slogan' => 'Cars. People. Culture.',
    ]];
@endphp
<x-public.layout :title="__('public.home.title')" :description="__('public.home.description')" :canonical="$canonical" :json-ld="$json" :auto-icons="true">
    <x-public.top-bar />

    <main id="main" class="flex-1" data-testid="WEB-03.root">
        {{-- FS-1 on the web: full-bleed night photo, bottom scrim, the wordmark as delivered, then the line and one brand CTA. --}}
        <section class="sc-land-hero sc-grain" data-testid="WEB-03.hero" data-qa-exempt="photo">
            <x-public.photo :photo="$hero" sizes="100vw" :priority="true" alt="" class="sc-land-hero-img" />
            <span class="sc-land-hero-scrim" aria-hidden="true"></span>
            <div class="sc-land-hero-inner">
                {{-- Not the LCP element: the photo and the two preloaded fonts take the bandwidth first. --}}
                <img src="{{ asset('brand/logo-wide-white-640.webp') }}" srcset="{{ asset('brand/logo-wide-white-640.webp') }} 640w, {{ asset('brand/logo-wide-white-1280.webp') }} 1280w" sizes="(min-width: 768px) 480px, 72vw" width="640" height="192" alt="SPEED CLUB" decoding="async" fetchpriority="low" class="sc-land-logo" data-testid="WEB-03.logo">
                <div class="sc-land-hero-block">
                    <h1 class="font-display text-display-xl uppercase text-on-photo" data-testid="WEB-03.claim">Cars. People. Culture.</h1>
                    <p class="mt-8 text-body text-on-photo-2">{{ __('public.home.lead') }}</p>
                    <div class="mt-24 flex flex-wrap gap-12">
                        <x-public.button :href="url('/app/sign-up')" variant="brand" size="l" data-testid="WEB-03.signUp">{{ __('public.home.sign_up') }}</x-public.button>
                        <x-public.button :href="url('/app')" variant="on-photo" size="l" data-testid="WEB-03.browse">{{ __('public.home.browse') }}</x-public.button>
                    </div>
                </div>
            </div>
        </section>

        {{-- The thought, set big and alone. --}}
        <section class="sc-land-thought" data-testid="WEB-03.thought">
            <span class="sc-rule" aria-hidden="true"></span>
            <h2 class="mt-16 font-display text-display-l text-ink">{{ __('public.home.thought_title') }}</h2>
            <p class="mt-12 text-body text-ink-2">{{ __('public.home.thought_body') }}</p>
        </section>

        {{-- Three steps of different weight and shape, not three cards. --}}
        <section class="sc-steps" aria-labelledby="steps-title" data-testid="WEB-03.steps">
            <h2 id="steps-title" class="sc-steps-title text-eyebrow uppercase text-ink-2">{{ __('public.home.steps_title') }}</h2>

            <article class="sc-step sc-step-photo-left" data-testid="WEB-03.step1">
                <div class="sc-step-media" data-qa-exempt="photo"><x-public.photo :photo="$wheel" :sizes="$stepSizes" class="h-full w-full object-cover" /></div>
                <div class="sc-step-copy">
                    <p class="font-display text-display-xl text-ink-3" aria-hidden="true">1</p>
                    <h3 class="mt-4 font-display text-display-m text-ink">{{ __('public.home.step1_title') }}</h3>
                    <p class="mt-8 text-body text-ink-2">{{ __('public.home.step1_body') }}</p>
                    @if ($vehicle && ($vehicle['highlights'][0] ?? null))
                        <ul class="sc-group mt-16" aria-label="{{ __('public.home.step1_example') }}">
                            <x-public.mod-row :mod="$vehicle['highlights'][0]" />
                        </ul>
                    @endif
                </div>
            </article>

            <article class="sc-step sc-step-qr" data-testid="WEB-03.step2">
                <div class="sc-step-copy">
                    <p class="font-display text-display-xl text-ink-3" aria-hidden="true">2</p>
                    <h3 class="mt-4 font-display text-display-m text-ink">{{ __('public.home.step2_title') }}</h3>
                    <p class="mt-8 text-body text-ink-2">{{ __('public.home.step2_body') }}</p>
                    @if ($qr)
                        <p class="mt-12 text-supporting text-ink-2">{{ __('public.home.step2_try') }}</p>
                    @endif
                </div>
                <div class="sc-step-stage" data-qa-exempt="photo">
                    <x-public.photo :photo="$taillight" :sizes="$stepSizes" class="sc-step-stage-img" />
                    @if ($qr)
                        <figure class="sc-qr" data-testid="WEB-03.qr" data-qa-exempt="qr">
                            <a href="{{ $qr['url'] }}" class="sc-focus sc-qr-code block" aria-label="{{ __('public.home.qr_label', ['code' => $qr['code']]) }}">{{ $qr['svg'] }}</a>
                            <figcaption class="mt-8 text-center">
                                <span class="block text-code uppercase tabular-nums text-qr-fg">{{ $qr['code'] }}</span>
                            </figcaption>
                        </figure>
                    @endif
                </div>
            </article>

            <article class="sc-step sc-step-photo-right" data-testid="WEB-03.step3">
                <div class="sc-step-media" data-qa-exempt="photo"><x-public.photo :photo="$station" :sizes="$stepSizes" class="h-full w-full object-cover" /></div>
                <div class="sc-step-copy">
                    <p class="font-display text-display-xl text-ink-3" aria-hidden="true">3</p>
                    <h3 class="mt-4 font-display text-display-m text-ink">{{ __('public.home.step3_title') }}</h3>
                    <p class="mt-8 text-body text-ink-2">{{ __('public.home.step3_body') }}</p>
                </div>
            </article>
        </section>

        @if ($vehicle && $featuredPhoto)
            {{-- FS-2's featured build: edge to edge on purpose, and a real page behind it. On a phone the 16:9 band is too low to carry the title
                 without covering the car, so the title follows the photo there and sits on its scrim from 768 up (public.css). --}}
            <section class="sc-feature" aria-labelledby="feature-title" data-testid="WEB-03.featured">
                <a href="{{ \App\Support\PublicUrl::to('/v/'.$vehicle['slug']) }}" class="sc-focus sc-feature-link" data-qa-exempt="photo" data-testid="WEB-03.featuredLink">
                    <span class="sc-feature-photo">
                        <x-public.photo :photo="$featuredPhoto" sizes="100vw" :alt="$featuredPhoto['alt'] ?: $vehicle['full_title']" class="absolute inset-0 h-full w-full object-cover" />
                        <span class="sc-scrim sc-feature-scrim" aria-hidden="true"></span>
                    </span>
                    <span class="sc-feature-text">
                        <span class="sc-feature-quiet block text-eyebrow uppercase">{{ __('public.home.featured') }}</span>
                        <span id="feature-title" class="sc-feature-title mt-4 block font-display text-display-l">{{ \App\Support\KeepTogether::name($vehicle['full_title']) }}</span>
                        @if ($owner)
                            <span class="sc-feature-quiet mt-4 block text-supporting">{{ '@'.$owner['username'] }}{{ $owner['city'] ? ' · '.$owner['city'] : '' }}</span>
                        @endif
                    </span>
                </a>
                <div class="sc-feature-body">
                    <div>
                        <x-public.spec-strip :items="$vehicle['spec_strip']" testid="WEB-03.featuredStrip" />
                        <x-public.button :href="\App\Support\PublicUrl::to('/v/'.$vehicle['slug'])" variant="primary" size="l" class="mt-16" data-testid="WEB-03.featuredCta">{{ __('public.home.featured_cta') }} <x-public.icon name="arrow-right" :size="20" /></x-public.button>
                    </div>
                    @if ($vehicle['highlights'] !== [])
                        <ul class="sc-group" data-testid="WEB-03.featuredMods">
                            @foreach ($vehicle['highlights'] as $mod)
                                <x-public.mod-row :mod="$mod" />
                            @endforeach
                        </ul>
                    @endif
                </div>
            </section>
        @endif

        {{-- Honest: no store badges until the listings exist. The web app is real today. --}}
        <section id="app" class="sc-app" aria-labelledby="app-title" data-testid="WEB-03.app">
            <div class="sc-app-texture" data-qa-exempt="photo">
                <img src="{{ asset('brand/logo-wide-on-texture.webp') }}" width="1600" height="900" alt="" loading="lazy" class="h-full w-full object-cover">
            </div>
            <div class="sc-app-copy">
                <h2 id="app-title" class="font-display text-display-l text-ink">{{ __('public.home.app_title') }}</h2>
                <p class="mt-8 text-body text-ink-2">{{ __('public.home.app_body') }}</p>
                <div class="mt-24"><x-public.button :href="url('/app')" variant="primary" size="l" data-testid="WEB-03.openWebApp">{{ __('public.home.open_app') }}</x-public.button></div>
                <ul class="sc-group mt-24" data-testid="WEB-03.stores">
                    @foreach (['App Store' => $store_ios, 'Google Play' => $store_android] as $store => $url)
                        <li class="sc-store">
                            <x-public.icon name="device-mobile" :size="20" class="text-ink-2" />
                            <span class="min-w-0 flex-1 text-body text-ink">{{ $store }}</span>
                            @if ($url)
                                <a href="{{ $url }}" class="sc-focus inline-flex min-h-44 items-center rounded-xs text-label-s text-ink">{{ __('public.home.store_open') }}</a>
                            @else
                                <x-public.status-pill :label="__('public.home.store_soon')" />
                            @endif
                        </li>
                    @endforeach
                </ul>
            </div>
        </section>
    </main>
</x-public.layout>
