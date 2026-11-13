{{--
    The link preview of a page (Open Graph, X card) and its icons, at the top of <head> so a crawler that reads only the first
    kilobytes finds all of it. Used by the Blade layout and by the /app/v and /app/u fallback (SpaController). Every address is
    absolute and HTTPS whenever the site is. Two images: the 1200 × 630 card first (WhatsApp, iMessage, Facebook, X use the first),
    then the 1080 × 1080 square for the apps that prefer one. Colours from the tokens (DesignTokens), never typed here.
    Expects: $title, $description (nullable), $canonical (nullable), $images {landscape, square}, $imageAlt, $ogType, $locale.
--}}
@php
    $shareUrl = \App\Support\PublicUrl::secure($canonical ?? url()->current());
    $alt = $imageAlt ?? config('app.name');
    $ogLocale = $locale === 'en' ? 'en_GB' : 'de_DE';
@endphp
<meta property="og:site_name" content="{{ config('app.name') }}">
<meta property="og:type" content="{{ $ogType }}">
<meta property="og:title" content="{{ $title }}">
@if ($description)
<meta property="og:description" content="{{ $description }}">
@endif
<meta property="og:url" content="{{ $shareUrl }}">
<meta property="og:locale" content="{{ $ogLocale }}">
<meta property="og:locale:alternate" content="{{ $ogLocale === 'de_DE' ? 'en_GB' : 'de_DE' }}">
@foreach ([[$images['landscape'], 1200, 630], [$images['square'], 1080, 1080]] as [$imageUrl, $imageWidth, $imageHeight])
<meta property="og:image" content="{{ \App\Support\PublicUrl::secure($imageUrl) }}">
<meta property="og:image:secure_url" content="{{ \App\Support\PublicUrl::secure($imageUrl) }}">
<meta property="og:image:type" content="image/jpeg">
<meta property="og:image:width" content="{{ $imageWidth }}">
<meta property="og:image:height" content="{{ $imageHeight }}">
<meta property="og:image:alt" content="{{ $alt }}">
@endforeach
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{{ $title }}">
@if ($description)
<meta name="twitter:description" content="{{ $description }}">
@endif
<meta name="twitter:image" content="{{ \App\Support\PublicUrl::secure($images['landscape']) }}">
<meta name="twitter:image:alt" content="{{ $alt }}">
<meta name="theme-color" media="(prefers-color-scheme: dark)" content="{{ \App\Support\DesignTokens::color('bg-canvas') }}">
<meta name="theme-color" media="(prefers-color-scheme: light)" content="{{ \App\Support\DesignTokens::color('bg-canvas', 'light') }}">
<link rel="icon" href="{{ asset('favicon.ico') }}" sizes="any">
<link rel="icon" type="image/png" href="{{ asset('favicon-32.png') }}" sizes="32x32">
<link rel="apple-touch-icon" href="{{ asset('apple-touch-icon.png') }}" sizes="180x180">
<link rel="manifest" href="{{ asset('site.webmanifest') }}">
