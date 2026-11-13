@props(['title', 'href' => null, 'action' => null, 'level' => 'h3', 'count' => null, 'icon' => null])
{{-- §13 section header: title.s, an optional glyph and count, an optional trailing link. --}}
<div {{ $attributes->class('flex flex-wrap items-center justify-between gap-x-16') }}>
    <{{ $level }} class="flex min-w-0 items-center gap-8 text-headline text-ink">
        @if ($icon)
            <x-public.icon :name="$icon" :size="20" class="text-ink-2" />
        @endif
        <span class="min-w-0">{{ $title }}</span>
        @if ($count !== null)
            <span class="font-ui text-callout tabular-nums text-ink-3">{{ $count }}</span>
        @endif
    </{{ $level }}>
    @if ($href && $action)
        <a href="{{ $href }}" class="sc-focus inline-flex min-h-44 items-center gap-4 rounded-xs text-callout text-ink-2 hover:text-ink">{{ $action }}<x-public.icon name="caret-right" :size="16" /></a>
    @endif
</div>
