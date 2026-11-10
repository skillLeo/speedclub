@props(['items', 'testid' => 'VEH-01.specStrip'])
{{-- FS-3 spec strip. A list, so a screen reader says "500 PS". At large text a quarter of a phone is too narrow, so public.css goes to two columns on two rows. --}}
<div {{ $attributes->class('sc-strip-box text-body') }}>
    <ul class="sc-strip" data-testid="{{ $testid }}">
        @foreach ($items as $entry)
            <li class="sc-strip-cell" data-spec="{{ $entry['key'] }}">
                <span class="font-display text-spec-strip tabular-nums text-ink">{{ $entry['value'] ?? '–' }}</span>
                <span class="text-caption text-ink-3">{{ $entry['label'] }}</span>
            </li>
        @endforeach
    </ul>
</div>
