@props([
    'title',
    'description' => null,
    'robots' => null,
    'canonical' => null,
    'image' => null,
    // 1080 × 1080 beside the 1200 × 630 $image; null takes the brand card's square (or $image itself when only that is given).
    'imageSquare' => null,
    'imageAlt' => null,
    'ogType' => 'website',
    'jsonLd' => [],
    'footer' => true,
    'autoIcons' => false,
    // The face of the page's h1 role, preloaded with Inter Regular (components/font-preload): 'marque' for t-display-title, 'title' for t-title-*.
    'display' => 'title',
])
@include('public.layouts.base')
