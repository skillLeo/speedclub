{{--
    Every public page, through x-public.layout. No style attributes anywhere: the CSP has no 'unsafe-inline' (05_ARCHITECTURE §15), so what differs per photo lands in
    the nonced style blocks below. The slot renders before this file, so its pushes are all here. sc-photo-css carries per-photo values and is
    escaped here; sc-layout-css carries per-component layout CSS that the pushing component prints itself, as an HtmlString built from numbers
    and fixed selectors only, never from member input (the spec strip's container queries, App\Support\SpecStripLayout::style(), and the display titles' sizes
    and code bindings, App\Support\DisplayTitleLayout::style()).
--}}
@php
    // The matrix compares these with what it asked for (tests/e2e/README.md). Null in production.
    $qa = \App\Http\Middleware\PublicPageContext::qa(request());
    $robots = config('speedclub.public_pages.allow_indexing') ? $robots : 'noindex';
    // The page's own cards, else the brand card (OgImages::defaultCards: staff's published default first).
    $defaults = $image === null || $imageSquare === null ? app(\App\Services\PublicPages\OgImages::class)->defaultCards() : null;
    $images = ['landscape' => $image ?? $defaults['landscape'], 'square' => $imageSquare ?? ($image === null ? $defaults['square'] : $image)];
    $locale = str_replace('_', '-', app()->getLocale());
    // Canonical, og:url and the language links are read out of context: always HTTPS where the site is.
    $canonical = $canonical === null ? null : \App\Support\PublicUrl::secure((string) $canonical);
    $photoCss = trim($__env->yieldPushContent('sc-photo-css'));
    $layoutCss = trim($__env->yieldPushContent('sc-layout-css'));
    // A word joiner (U+2060) keeps "E-Mail" or "QR-Code" whole on the page (SafeMarkdown::joinShortCompounds); a tab title, a search
    // snippet or a shared card has no line to keep, so the head carries the plain text.
    $title = str_replace("\u{2060}", '', (string) $title);
    $description = $description === null ? null : str_replace("\u{2060}", '', (string) $description);
    $imageAlt = $imageAlt === null ? null : str_replace("\u{2060}", '', (string) $imageAlt);
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
        {{-- What a link preview reads comes first, before the inline script and the inlined stylesheet (crawlers read only the start). --}}
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
        @include('public.partials.share-meta', ['images' => $images, 'imageAlt' => $imageAlt, 'ogType' => $ogType, 'locale' => $locale, 'canonical' => $canonical, 'title' => $title, 'description' => $description])
        <meta name="color-scheme" content="dark light">
        @unless ($qa)
            <x-theme-script />
        @endunless
        @stack('sc-preload')
        <x-font-preload :display="$display" />
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
        @if ($layoutCss !== '')
            <style nonce="{{ Vite::cspNonce() }}">@stack('sc-layout-css')</style>
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
        <a href="#main" class="sc-skip text-callout" data-testid="WEB.skip">{{ __('public.nav.skip') }}</a>
        <div class="flex min-w-0 flex-1 flex-col">
            {{ $slot }}
        </div>
        @if ($footer)
            <x-public.footer />
        @endif
    </body>
</html>
