@props(['label'])
{{-- §8 status pill: 20 high, radius 4, 1 border.default, label.badge text.secondary: the role of the app's StatusPill (labelBadge, capped at
     1.3, ADR-421 a, ADR-423), never hyphenated and never broken (DQ-923: "Googl/e Play", "Teilegut-/achten" at 200 %). --}}
<span {{ $attributes->class('inline-flex min-h-20 items-center rounded-xs border border-line px-8 text-center text-label-badge whitespace-nowrap hyphens-none text-ink-2') }}>{{ $label }}</span>
