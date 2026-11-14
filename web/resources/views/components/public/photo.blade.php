@props(['photo', 'sizes' => '100vw', 'priority' => false, 'alt' => null])
{{--
    §7: WebP srcset, explicit size, the blurhash behind it, the focal point respected. $photo has the shape of MediaResource (or App\Services\PublicPages\PublicPhoto::brand).
    Sizing is up to the parent: an aspect-ratio box. A variant list without a usable file prints nothing, and the box keeps its own surface.
    priority: the page's hero (preload, high, sync decode), its one eager photo. Everything else is deferred (M4.16 LCP): lazy, and its
    file is named only in data-sc-src/-srcset until the hero has painted (resources/js/public/app.ts deferredPhotos), so no other photo
    shares the bandwidth before the LCP (WEB-02's first garage card did, eager, until ADR-469 gave every profile a cover). Until then
    the img shows a transparent pixel over its blurhash; without JavaScript the <noscript> copy is the photo and the placeholder img is
    hidden (public.css, scripting: none).
--}}
@php
    $variants = collect($photo['variants'] ?? []);
    $default = $variants->first(fn (array $variant): bool => $variant['width'] >= 1080) ?? $variants->last();
    $class = \App\Services\PublicPages\PublicPhoto::className($photo);
    $css = \App\Services\PublicPages\PublicPhoto::css($photo, $class);
    $srcset = $variants->map(fn (array $variant): string => $variant['url'].' '.$variant['width'].'w')->implode(', ');
@endphp
@if ($default)
    @if ($css !== '')
        @pushOnce('sc-photo-css', $class)
{{ $css }}
        @endPushOnce
    @endif
    @if ($priority)
        @push('sc-preload')
            <link rel="preload" as="image" type="image/webp" imagesrcset="{{ $srcset }}" imagesizes="{{ $sizes }}" fetchpriority="high">
        @endpush
        <img
            src="{{ $default['url'] }}"
            srcset="{{ $srcset }}"
            sizes="{{ $sizes }}"
            width="{{ $photo['width'] ?? $default['width'] }}"
            height="{{ $photo['height'] ?? $default['height'] }}"
            alt="{{ $alt ?? ($photo['alt'] ?? '') }}"
            decoding="sync"
            fetchpriority="high"
            {{ $attributes->class(['sc-photo', $class]) }}
        >
    @else
        <img
            src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"
            data-sc-src="{{ $default['url'] }}"
            data-sc-srcset="{{ $srcset }}"
            sizes="{{ $sizes }}"
            width="{{ $photo['width'] ?? $default['width'] }}"
            height="{{ $photo['height'] ?? $default['height'] }}"
            alt="{{ $alt ?? ($photo['alt'] ?? '') }}"
            decoding="async"
            loading="lazy"
            {{ $attributes->class(['sc-photo', $class]) }}
        ><noscript><img
            src="{{ $default['url'] }}"
            srcset="{{ $srcset }}"
            sizes="{{ $sizes }}"
            width="{{ $photo['width'] ?? $default['width'] }}"
            height="{{ $photo['height'] ?? $default['height'] }}"
            alt="{{ $alt ?? ($photo['alt'] ?? '') }}"
            decoding="async"
            loading="lazy"
            {{ $attributes->class(['sc-photo', $class]) }}
        ></noscript>
    @endif
@endif
