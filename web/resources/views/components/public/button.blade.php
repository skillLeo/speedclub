@props(['href', 'variant' => 'secondary', 'size' => 'm'])
{{-- §8 button. A link on these pages, since every action leads somewhere else. Size S grows to the 44 touch target through its ::before. The outline of the outlined variants is an inset ring: it takes no layout, so the label inset is 20 / 16 / 12 on every variant, as in the app's Button (DQ-065). --}}
@php
    $sizes = [
        'l' => 'min-h-52 px-20 py-8 text-label',
        'm' => 'min-h-44 px-16 py-8 text-label',
        's' => 'min-h-36 px-12 py-4 text-label-s before:absolute before:inset-x-0 before:-inset-y-8',
    ];
    $variants = [
        'primary' => 'bg-inverse text-ink-inverse',
        'brand' => 'bg-accent-fill text-on-accent hover:bg-accent-fill-pressed',
        'secondary' => 'bg-raised text-ink ring-1 ring-line ring-inset hover:bg-overlay',
        'tertiary' => 'text-ink hover:bg-hover',
        'on-photo' => 'text-on-photo ring-1 ring-on-photo-line ring-inset hover:bg-on-photo-chip',
    ];
@endphp
<a href="{{ $href }}" {{ $attributes->class(['sc-focus relative inline-flex items-center justify-center gap-8 rounded-sm text-center', $sizes[$size], $variants[$variant]]) }}>{{ $slot }}</a>
