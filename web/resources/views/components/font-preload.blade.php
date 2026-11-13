{{--
    Exactly two faces per surface, the ones the first paint needs (09 §4.2 "preload only the two faces used above the fold", ADR-402,
    docs/reports/phase-4/m4.1-fonts.md). Public pages: body text in Inter Regular, plus the face of the page's h1 role. That is
    Archivo SemiExpanded SemiBold ('marque') where the h1 is a car name or brand claim in t-display-title (WEB-01 vehicle, WEB-03 home),
    and Inter Display SemiBold ('title') where it is t-title-1/t-title-2 (every other public page). The page passes it to
    x-public.layout as display="marque"; WebFontsTest checks every page family against its h1. Admin: the shell (body, rows, nav) is
    Inter at 400 and 500, its h1 one Inter 600 line in an Inertia page. The rest loads on use (font-display: swap). crossorigin stays:
    a font request is CORS-mode even on the same origin, without it the file loads twice.
--}}
@props(['surface' => 'public', 'display' => 'title'])
@php
    $faces = $surface === 'admin'
        ? ['resources/fonts/2.0/Inter-Regular.woff2', 'resources/fonts/2.0/Inter-Medium.woff2']
        : [
            'resources/fonts/2.0/Inter-Regular.woff2',
            match ($display) {
                'marque' => 'resources/fonts/2.0/ArchivoSemiExpanded-SemiBold.woff2',
                'title' => 'resources/fonts/2.0/InterDisplay-SemiBold.woff2',
            },
        ];
@endphp
@foreach ($faces as $face)
<link rel="preload" as="font" type="font/woff2" crossorigin href="{{ Vite::asset($face) }}">
@endforeach
