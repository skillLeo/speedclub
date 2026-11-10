@props(['photo', 'sizes' => '100vw', 'priority' => false, 'eager' => false, 'alt' => null])
{{--
    §7: WebP srcset, explicit size, the blurhash behind it, the focal point respected. $photo has the shape of MediaResource (or App\Services\PublicPages\PublicPhoto::brand).
    Sizing is up to the parent: an aspect-ratio box. A variant list without a usable file prints nothing, and the box keeps its own surface.
    priority: the page's hero (preload, high, sync decode). eager: in the first viewport but not the hero, loaded at the browser's own priority
    instead of lazily (a lazy image there waits for layout and can become the LCP). Everything else is lazy and low.
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
    @endif
    <img
        src="{{ $default['url'] }}"
        srcset="{{ $srcset }}"
        sizes="{{ $sizes }}"
        width="{{ $photo['width'] ?? $default['width'] }}"
        height="{{ $photo['height'] ?? $default['height'] }}"
        alt="{{ $alt ?? ($photo['alt'] ?? '') }}"
        decoding="{{ $priority ? 'sync' : 'async' }}"
        @if ($priority) fetchpriority="high" @elseif (! $eager) loading="lazy" fetchpriority="low" @endif
        {{ $attributes->class(['sc-photo', $class]) }}
    >
@endif
