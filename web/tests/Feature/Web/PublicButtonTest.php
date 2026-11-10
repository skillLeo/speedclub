<?php

use Illuminate\Support\Facades\Blade;
use Illuminate\Support\Str;

// DQ-065: the label inset is the size's padding on every variant, as in the app's Button, so an outline must not take layout.
// A border of 1 on top of the padding moved every button after it in the Blade owner row, which the parity spec caught.
it('outlines without taking layout, so the label inset is the same on every variant', function (string $variant, ?string $ring) {
    $html = Blade::render('<x-public.button href="/x" :variant="$variant">Folgen</x-public.button>', ['variant' => $variant]);
    $classes = Str::match('/class="([^"]*)"/', $html);

    expect($classes)->toContain('px-16');
    expect($classes)->not->toMatch('/(^|\s)border(-|\s|$)/');

    if ($ring !== null) {
        expect($classes)->toContain('ring-1')->toContain('ring-inset')->toContain($ring);
    }
})->with([
    'primary' => ['primary', null],
    'brand' => ['brand', null],
    'secondary' => ['secondary', 'ring-line'],
    'tertiary' => ['tertiary', null],
    'on-photo' => ['on-photo', 'ring-on-photo-line'],
]);
