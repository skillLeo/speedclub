@props(['row'])
{{-- §8 spec row: at least 48 high, label left, value right, provenance under anything that is not the factory figure. --}}
@php
    $numeric = preg_match('/^[\d.,\s−-]+/u', (string) $row['value']) === 1;
    $source = ($row['source'] ?? null) !== 'factory' ? ($row['source_label'] ?? null) : null;
@endphp
<div {{ $attributes->class('sc-spec-row') }}>
    <dt class="sc-spec-label text-callout text-ink-2">{{ $row['label'] }}</dt>
    <dd class="sc-spec-end">
        <span class="block text-body-strong text-ink {{ $numeric ? 'tabular-nums' : '' }}">{{ $row['value'] }}</span>
        @if ($source)
            <span class="block text-caption text-ink-3" data-testid="WEB-01.provenance">{{ $source }}</span>
        @endif
    </dd>
</div>
