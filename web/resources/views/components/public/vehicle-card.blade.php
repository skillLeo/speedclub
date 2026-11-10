@props(['card', 'sizes' => '(min-width: 1280px) 400px, (min-width: 768px) 50vw, 78vw', 'testid' => 'WEB-02.vehicle', 'eager' => false])
{{-- §8 vehicle card: 4:3 photo radius 12, title.s, supporting sub-line, spec chips, Hauptfahrzeug badge on the photo. --}}
@php
    $chips = collect($card['spec_strip'] ?? [])
        ->filter(fn (array $entry): bool => $entry['value'] !== null && $entry['value'] !== (string) ($card['model_year'] ?? ''))
        ->map(fn (array $entry): string => $entry['value'].(($entry['unit'] ?? null) ? ' '.$entry['unit'] : ''));
    $subline = array_slice($card['subline_parts'] ?? [], 0, 2);
@endphp
<a href="{{ \App\Support\PublicUrl::to('/v/'.$card['slug']) }}" {{ $attributes->class('sc-focus sc-press block rounded-md') }} data-testid="{{ $testid }}">
    <span class="relative block aspect-[4/3] w-full overflow-hidden rounded-md bg-surface" data-qa-exempt="photo">
        @if ($card['cover'])
            <x-public.photo :photo="$card['cover']" :sizes="$sizes" :eager="$eager" :alt="$card['cover']['alt'] ?: $card['full_title']" class="absolute inset-0 h-full w-full object-cover" />
        @else
            <span class="absolute inset-0 flex items-center justify-center text-ink-3"><x-public.icon name="device-mobile" :size="24" /></span>
        @endif
        @if ($card['is_main'])
            <span class="absolute top-12 left-12 inline-flex min-h-20 items-center rounded-xs border border-accent bg-on-photo-chip px-8 text-badge text-on-photo">{{ __('public.vehicle.main') }}</span>
        @endif
    </span>
    <span class="mt-12 block text-title-s text-ink">{{ \App\Support\KeepTogether::name($card['full_title']) }}</span>
    @if ($subline !== [])
        <span class="block text-supporting text-ink-2">{{ implode(' · ', $subline) }}</span>
    @endif
    @if ($chips->isNotEmpty())
        <span class="mt-8 flex flex-wrap gap-4">
            @foreach ($chips as $chip)
                <span class="inline-flex min-h-24 items-center rounded-xs bg-raised px-8 text-caption tabular-nums text-ink">{{ $chip }}</span>
            @endforeach
        </span>
    @endif
</a>
