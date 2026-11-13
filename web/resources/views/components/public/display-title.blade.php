@props(['text', 'as' => 'h1', 'placement' => 'page', 'base' => false, 'name' => true])
{{-- display.title on the public pages (ADR-425/426 as amended): the size of the app's DisplayTitle, chosen by App\Support\DisplayTitleLayout
     (mirroring mobile/src/ui/displayTitleLayout.ts) through container queries on the container sc-title (.sc-title-box), pushed once per
     title and placement into the nonced style block of the layout (stack sc-layout-css). `placement` is "page", "card" or per range
     ['phone' => …, 'tablet' => …, 'desktop' => …]. `base` sets the phone pair at every width (.t-display-title-base, a title in a card,
     ADR-426 b). A car name (`name`) wraps like the app's vehicleTitleText: never inside "GT-R" or "C 63", and a trailing code ("VIII (CD)")
     stays with the word before it only where the rule binds it (a breakable space remains before the pair, and the pair fits the line
     at the drawn size: the same queries switch the pair's .sc-bind span). Balanced lines, no automatic hyphens (public.css .sc-display-title). --}}
@php
    $estimated = $name ? \App\Support\KeepTogether::titleText($text) : (string) $text;
    $titleClass = \App\Support\DisplayTitleLayout::className($estimated, $placement, (bool) $name);
@endphp
@pushOnce('sc-layout-css', $titleClass)
{{ \App\Support\DisplayTitleLayout::style($estimated, $titleClass, $placement, (bool) $name) }}
@endPushOnce
<{{ $as }} {{ $attributes->class(['sc-display-title', $base ? 't-display-title-base' : 't-display-title', $titleClass]) }}>{{ $name ? \App\Support\KeepTogether::title($text) : $text }}</{{ $as }}>
