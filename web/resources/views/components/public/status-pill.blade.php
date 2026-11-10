@props(['label'])
{{-- §8 status pill: 20 high, radius 4, 1 border.default, badge text.secondary. --}}
<span {{ $attributes->class('inline-flex min-h-20 items-center rounded-xs border border-line px-8 text-center text-badge text-ink-2') }}>{{ $label }}</span>
