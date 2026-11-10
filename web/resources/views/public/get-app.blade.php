{{--
    WEB-04 /app-laden (m2.7-contract §2). Sessionless. The platform only orders the store buttons, it never hides one. Store links may be empty
    before the launch: then "Bald …", not a link. Staging: the tester APK with its SHA-256. Desktop: a QR code to this page.
--}}
@php
    $labels = ['ios' => __('public.get_app.app_store'), 'android' => __('public.get_app.google_play')];
    $soon = ['ios' => __('public.get_app.soon_app_store'), 'android' => __('public.get_app.soon_google_play')];
@endphp
<x-public.layout :title="__('public.get_app.title').' · SPEED CLUB'" :description="__('public.get_app.description')" :canonical="url('/app-laden')">
    <x-public.top-bar />
    <main id="main" class="sc-form-page flex-1" data-testid="WEB-04.root" data-platform="{{ $platform }}">
        <div class="sc-form-measure">
            <h1 class="text-title-l text-ink" data-testid="WEB-04.title">{{ __('public.get_app.title') }}</h1>
            <p class="mt-8 text-body text-ink-2" data-testid="WEB-04.intro">{{ __('public.get_app.intro') }}</p>

            <div class="mt-24 flex flex-wrap gap-8" data-testid="WEB-04.stores">
                @foreach ($stores as $store)
                    @if ($store['url'] !== null)
                        <x-public.button :href="$store['url']" :variant="$loop->first ? 'brand' : 'secondary'" size="l" rel="noopener" data-testid="WEB-04.store.{{ $store['key'] }}">{{ $labels[$store['key']] }}</x-public.button>
                    @else
                        <p class="inline-flex min-h-52 items-center rounded-sm px-20 text-label text-ink-2 ring-1 ring-line ring-inset" data-testid="WEB-04.soon.{{ $store['key'] }}">{{ $soon[$store['key']] }}</p>
                    @endif
                @endforeach
            </div>

            <p class="mt-16 text-supporting text-ink-3" data-testid="WEB-04.web">
                {{ __('public.get_app.web_hint') }}
                <a class="sc-focus underline text-ink-2" href="{{ url('/app') }}" data-testid="WEB-04.webApp">{{ __('public.get_app.web_link') }}</a>
            </p>

            {{-- DQ-432: the QR display of 03 §8 (white card, radius 16, padding 24, QR 208 ≥ 200, URL in qr.caption), from 768 only.
                 A phone is already the device the code would hand over to, so there the store buttons above are the way. --}}
            @if ($qr !== null)
                <div class="mt-24 hidden items-center gap-24 tablet:flex" data-testid="WEB-04.qr">
                    <figure class="sc-qr shrink-0" data-qa-exempt="qr">
                        <img src="{{ $qr }}" width="208" height="208" alt="{{ __('public.get_app.qr_alt') }}" class="block h-auto w-full">
                        <figcaption class="mt-8 text-center text-caption text-qr-caption" data-testid="WEB-04.qrUrl">{{ preg_replace('#^https?://#i', '', $pageUrl) }}</figcaption>
                    </figure>
                    <p class="min-w-0 flex-1 text-supporting text-ink-2">{{ __('public.get_app.qr_hint') }}</p>
                </div>
            @endif

            @if ($apk !== null)
                <section class="mt-24" aria-labelledby="tester-title" data-testid="WEB-04.tester">
                    <h2 id="tester-title" class="text-title-m text-ink">{{ __('public.get_app.tester_title') }}</h2>
                    <p class="mt-8 text-body text-ink-2">{{ __('public.get_app.tester_body') }}</p>
                    <div class="mt-16 flex flex-wrap gap-8">
                        <x-public.button :href="$apk['url']" variant="secondary" size="l" data-testid="WEB-04.apk">{{ __('public.get_app.tester_download') }}</x-public.button>
                    </div>
                    @if ($apk['sha256'] !== null)
                        <p class="mt-8 text-supporting text-ink-3" data-testid="WEB-04.sha256">{{ __('public.get_app.tester_sha') }} <code>{{ $apk['sha256'] }}</code></p>
                    @endif
                </section>
            @endif
        </div>
    </main>
</x-public.layout>
