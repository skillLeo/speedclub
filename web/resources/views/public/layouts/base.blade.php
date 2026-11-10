{{--
    Every public page, through x-public.layout. No style attributes anywhere: the CSP has no 'unsafe-inline' (05_ARCHITECTURE §15), so what differs per photo lands in
    the nonced style block below. The slot renders before this file, so its pushes are all here.
--}}
@php
    // The matrix compares these with what it asked for (tests/e2e/README.md). Null in production.
    $qa = \App\Http\Middleware\PublicPageContext::qa(request());
    $robots = config('speedclub.public_pages.allow_indexing') ? $robots : 'noindex';
    $ogImage = $image ?? url(config('speedclub.public_pages.og_default'));
    $locale = str_replace('_', '-', app()->getLocale());
    $photoCss = trim($__env->yieldPushContent('sc-photo-css'));
@endphp
<!DOCTYPE html>
<html
    lang="{{ $locale }}"
    data-theme="{{ $qa['theme'] ?? 'system' }}"
    @if ($qa)
        data-qa-theme="{{ $qa['theme'] }}"
        data-qa-locale="{{ $qa['locale'] }}"
        data-qa-font-scale="{{ $qa['font_scale'] }}"
        data-qa-state="{{ $qa['state'] }}"
        data-qa-motion="{{ $qa['motion'] }}"
    @endif
>
    <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
        <meta name="color-scheme" content="dark light">
        @unless ($qa)
            <x-theme-script />
        @endunless
        <title>{{ $title }}</title>
        @if ($description)
            <meta name="description" content="{{ $description }}">
        @endif
        @if ($robots)
            <meta name="robots" content="{{ $robots }}">
        @endif
        @if ($canonical)
            <link rel="canonical" href="{{ \App\Support\PublicUrl::canonical($canonical) }}">
            <link rel="alternate" hreflang="de" href="{{ $canonical }}?lang=de">
            <link rel="alternate" hreflang="en" href="{{ $canonical }}?lang=en">
            <link rel="alternate" hreflang="x-default" href="{{ $canonical }}">
        @endif
        <meta property="og:site_name" content="{{ config('app.name') }}">
        <meta property="og:type" content="{{ $ogType }}">
        <meta property="og:title" content="{{ $title }}">
        @if ($description)
            <meta property="og:description" content="{{ $description }}">
        @endif
        <meta property="og:url" content="{{ $canonical ?? url()->current() }}">
        <meta property="og:locale" content="{{ $locale === 'en' ? 'en_GB' : 'de_DE' }}">
        <meta property="og:image" content="{{ $ogImage }}">
        <meta property="og:image:width" content="1200">
        <meta property="og:image:height" content="630">
        <meta property="og:image:alt" content="{{ $imageAlt ?? config('app.name') }}">
        <meta name="twitter:card" content="summary_large_image">
        <meta name="twitter:title" content="{{ $title }}">
        @if ($description)
            <meta name="twitter:description" content="{{ $description }}">
        @endif
        <meta name="twitter:image" content="{{ $ogImage }}">
        <meta name="twitter:image:alt" content="{{ $imageAlt ?? config('app.name') }}">
        <link rel="icon" href="{{ asset('favicon.ico') }}" sizes="any">
        <link rel="icon" type="image/png" href="{{ asset('favicon-32.png') }}" sizes="32x32">
        <link rel="apple-touch-icon" href="{{ asset('apple-touch-icon.png') }}">
        @stack('sc-preload')
        <x-font-preload />
        @if (Vite::isRunningHot())
            @vite(['resources/css/public.css', 'resources/js/public/app.ts'])
        @else
            {{-- Inline: no stylesheet round trip before the first paint (the file is our own build output, see InlineAsset). --}}
            <style nonce="{{ Vite::cspNonce() }}">{{ \App\Support\InlineAsset::css('resources/css/public.css') }}</style>
            @vite(['resources/js/public/app.ts'])
        @endif
        @if ($photoCss !== '')
            <style nonce="{{ Vite::cspNonce() }}">{{ $photoCss }}</style>
        @endif
        @foreach ($jsonLd as $block)
            <script type="application/ld+json" nonce="{{ Vite::cspNonce() }}">{{ \App\Support\JsonLd::encode($block) }}</script>
        @endforeach
        {{ $head ?? '' }}
    </head>
    <body class="flex min-h-screen flex-col bg-canvas font-ui text-body text-ink antialiased">
        <x-icons.phosphor-sprite />
        @if ($autoIcons)
            <x-icons.auto-sprite />
        @endif
        <a href="#main" class="sc-skip text-label-s" data-testid="WEB.skip">{{ __('public.nav.skip') }}</a>
        <div class="flex min-w-0 flex-1 flex-col">
            {{ $slot }}
        </div>
        @if ($footer)
            <x-public.footer />
        @endif
    </body>
</html>
