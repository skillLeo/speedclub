{{--
    WEB-03 Landing (R4-1.5, client round 4: "much simpler and cleaner"). Four parts, nothing else: (1) the full-bleed night photo with the
    logo, the claim, one sentence and the way in, all in the first viewport (R4DQ-06); (2) "Was du mit Speedclub machst" in four items, an
    editorial list (R4DQ-07); (3) the sticker in one block, with a real code to try and the link to the shop while it exists; (4) the
    download section (#app, where the top bar's "App laden" leads). The footer is the layout's. The QR steps, featured builds, meets and
    workshop teaser of M4.16 left the page; their components stay.
    R4DQ-23, one honest filled CTA: with store links the stores lead (and "Im Browser öffnen" stays a quiet link); without them the web app
    is the way in that works today, so "Im Browser öffnen" is the filled CTA and "So kommst du zur App" (WEB-04) the secondary.
--}}
@php
    $hero = \App\Services\PublicPages\PublicPhoto::brand('landing-hero');
    $taillight = \App\Services\PublicPages\PublicPhoto::brand('landing-taillight');
    // DQ-1177: the claim breaks only between its sentences ("Dein Auto." / "Dein Build." / "Dein Club."), never inside one: the spaces
    // within a sentence become no-break spaces, which the title's size rule also treats as unbreakable (DisplayTitleLayout::words).
    $claim = (string) preg_replace('/(?<![.!?]) /u', "\u{00A0}", (string) __('public.home.claim'));
    $items = [
        'garage' => 'garage-bay',
        'mods' => 'coilover',
        'meets' => 'meet',
        'discover' => 'compass',
    ];
    $json = [[
        '@context' => 'https://schema.org',
        '@type' => 'Organization',
        '@id' => $canonical.'#organization',
        'name' => config('app.name'),
        'url' => $canonical,
        'logo' => \App\Support\BrandFiles::url('brand/logo-wide-black-1280.png'),
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
        {{-- (1) The photo fades into its dark stage (scrim.photo); the claim starts at the large-text line, the lead below the text-safe
             line, and the copy flows onto the stage below the photo at any text size (ADR-421 b, DQ-917). The stage is dark in every
             theme, so the logo is the white one. --}}
        <section class="sc-land-hero" aria-labelledby="claim" data-testid="WEB-03.hero">
            <div class="sc-land-hero-media sc-grain" data-qa-exempt="photo">
                <x-public.photo :photo="$hero" sizes="100vw" :priority="true" alt="" class="h-full w-full object-cover" />
                <span class="sc-hero-scrim" aria-hidden="true"></span>
            </div>
            <div class="sc-land-hero-inner">
                {{-- R4DQ-61: no second logo in the hero at any width (it stood on the car's headlight at 1440, R4DQ-43/58 below); the top bar carries the brand. --}}
                {{-- The title box is the 640 measure itself, so the title's size rule counts the lines it really gets (ADR-426 a). --}}
                <div class="sc-title-box">
                    <x-public.display-title :text="$claim" :name="false" id="claim" class="text-on-photo" data-testid="WEB-03.claim" />
                </div>
                <p class="mt-8 text-body text-on-photo" data-testid="WEB-03.lead">{{ __('public.home.lead') }}</p>
                <div class="mt-24 flex flex-wrap items-center gap-x-16 gap-y-8" data-testid="WEB-03.heroActions">
                    @if ($stores !== [])
                        @foreach ($stores as $store => $url)
                            <x-public.button :href="$url" :variant="$loop->first ? 'brand' : 'on-photo'" size="l" rel="noopener" data-testid="WEB-03.heroStore"><x-public.icon name="device-mobile" :size="20" /><span class="whitespace-nowrap hyphens-none">{{ $store }}</span></x-public.button>
                        @endforeach
                        <a href="{{ url('/app') }}" class="sc-focus inline-flex min-h-44 items-center rounded-xs text-callout text-on-photo underline underline-offset-4" data-testid="WEB-03.openBrowser">{{ __('public.home.open_browser') }}</a>
                    @else
                        <x-public.button :href="url('/app')" variant="brand" size="l" data-testid="WEB-03.openBrowser">{{ __('public.home.open_browser') }}</x-public.button>
                        <x-public.button :href="\App\Support\PublicUrl::to('/app-laden')" variant="on-photo" size="l" data-testid="WEB-03.getApp">{{ __('public.home.get_app_how') }}</x-public.button>
                    @endif
                </div>
            </div>
        </section>

        {{-- (2) Four things a member does: an editorial list, the glyph inline at the left, the headline and one sentence beside it,
             a hairline over each item; 2 × 2 from 768, the heading beside the list from 1280 (R4DQ-07). No cards, no icon-on-top grid. --}}
        <section class="sc-land-section sc-land-do-wrap" aria-labelledby="do-title" data-testid="WEB-03.do">
            <h2 id="do-title" class="t-title-2 text-ink">{{ __('public.home.do_title') }}</h2>
            <ul class="sc-land-do">
                @foreach ($items as $key => $icon)
                    <li class="sc-land-do-item" data-testid="WEB-03.do.{{ $key }}">
                        <x-public.icon :name="$icon" :size="24" class="sc-land-do-glyph text-ink-2" />
                        <div class="sc-land-do-copy">
                            <h3 class="text-headline text-ink">{{ __('public.home.do_'.$key.'_title') }}</h3>
                            <p class="mt-4 text-callout text-ink-2">{{ __('public.home.do_'.$key.'_body') }}</p>
                        </div>
                    </li>
                @endforeach
            </ul>
        </section>

        {{-- (3) The sticker in one block: what it does, and the shop while it exists. The code beside it is real and leads to the lead
             build's page (never its /C/ address, LandingPage::sample). --}}
        <section id="sticker" class="sc-land-section sc-land-sticker" aria-labelledby="sticker-title" data-testid="WEB-03.sticker">
            <div class="sc-land-sticker-copy">
                <span class="sc-rule" aria-hidden="true"></span>
                <h2 id="sticker-title" class="mt-16 flex items-center gap-8 t-title-2 text-ink"><x-public.icon name="qr-sticker" :size="24" class="text-ink-2" />{{ __('public.home.sticker_title') }}</h2>
                <p class="mt-8 text-body text-ink-2">{{ __('public.home.sticker_body') }}</p>
                <ul class="sc-land-points mt-16">
                    @foreach (['page', 'insights', 'one'] as $point)
                        <li class="text-callout text-ink-2" data-testid="WEB-03.sticker.{{ $point }}">{{ __('public.home.sticker_point_'.$point) }}</li>
                    @endforeach
                </ul>
                @if ($shop)
                    <x-public.button :href="$shop" variant="secondary" size="l" class="mt-24" data-testid="WEB-03.stickerShop">{{ __('public.home.sticker_shop') }} <x-public.icon name="arrow-right" :size="20" /></x-public.button>
                @endif
            </div>
            <div class="sc-land-sticker-stage" data-qa-exempt="photo">
                <x-public.photo :photo="$taillight" sizes="(min-width: 1280px) 688px, (min-width: 768px) 58vw, 100vw" class="sc-land-sticker-img" />
                @if ($qr)
                    <figure class="sc-qr" data-testid="WEB-03.qr" data-qa-exempt="qr">
                        {{-- ADR-514: no sticker code in words either. A code typed off this page would count as a STREET DEX spot. --}}
                        <a href="{{ $qr['url'] }}" class="sc-focus sc-qr-code block" aria-label="{{ $qr['sample'] ? __('public.home.qr_label_sample') : __('public.home.qr_label') }}">{{ $qr['svg'] }}</a>
                        <figcaption class="mt-8 text-center text-caption text-qr-caption">
                            @if ($qr['sample'])
                                <x-public.sample-badges :sample="true" :editorial="$qr['editorial']" class="mb-4 justify-center" testid="WEB-03.qrSample" />
                            @endif
                            {{ $qr['sample'] ? __('public.home.sticker_try_sample') : __('public.home.sticker_try') }}
                        </figcaption>
                    </figure>
                @endif
            </div>
        </section>

        {{-- (4) Honest: store links only once the listings exist; WEB-04 always has every way to the app, the web app is real today. --}}
        <section id="app" class="sc-land-section sc-land-app" aria-labelledby="app-title" data-testid="WEB-03.app">
            <div>
                <h2 id="app-title" class="t-title-2 text-ink">{{ $stores === [] ? __('public.home.app_title') : __('public.home.app_title_stores') }}</h2>
                <p class="mt-8 text-body text-ink-2">{{ $stores === [] ? __('public.home.app_body') : __('public.home.app_body_stores') }}</p>
            </div>
            <div class="flex flex-wrap gap-8" data-testid="WEB-03.stores">
                @foreach ($stores as $store => $url)
                    <x-public.button :href="$url" variant="secondary" size="l" rel="noopener" data-testid="WEB-03.store"><x-public.icon name="device-mobile" :size="20" /><span class="whitespace-nowrap hyphens-none">{{ $store }}</span></x-public.button>
                @endforeach
                <x-public.button :href="\App\Support\PublicUrl::to('/app-laden')" variant="secondary" size="l" data-testid="WEB-03.appPage">{{ __('public.home.app_more') }}</x-public.button>
                <x-public.button :href="url('/app')" variant="tertiary" size="l" data-testid="WEB-03.browser">{{ __('public.home.open_browser') }}</x-public.button>
            </div>
        </section>
    </main>
</x-public.layout>
