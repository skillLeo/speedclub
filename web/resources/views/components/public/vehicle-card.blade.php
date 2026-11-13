@props(['card', 'sizes' => '(min-width: 1280px) 400px, (min-width: 768px) 50vw, 78vw', 'testid' => 'WEB-02.vehicle', 'eager' => false, 'variant' => 'feed'])
{{--
    feed (default): the §8 vehicle card of walls and lists: 4:3 photo radius 12, headline name, sub-line, spec chips, the Hauptfahrzeug badge.
    garage (M4.16, 09 §5 VehicleCard 2.0, the app's VehicleCard variant="garage" through garageCardProps, mobile/src/features/garage/card.ts):
    photo 4:5 radius 20, the name in display.title (placement card, Archivo: cars speak Archivo), the caption "Nissan · Skyline GT-R · R34 · 2002",
    a mini spec of power, torque and model year in hero.numeral.s + label.unit over label.caps. Badges (Hauptfahrzeug, Beispiel) on the photo in label.badge.
--}}
@php
    $garage = $variant === 'garage';
    $chips = collect($card['spec_strip'] ?? [])
        ->filter(fn (array $entry): bool => $entry['value'] !== null && $entry['value'] !== (string) ($card['model_year'] ?? ''))
        ->map(fn (array $entry): string => $entry['value'].(($entry['unit'] ?? null) ? ' '.$entry['unit'] : ''));
    $subline = array_slice($card['subline_parts'] ?? [], 0, 2);
    $caption = implode(' · ', array_filter([$card['make'] ?? null, $card['model'] ?? null, $card['generation'] ?? null, isset($card['model_year']) ? (string) $card['model_year'] : null], fn ($part): bool => is_string($part) && trim($part) !== ''));
    $stats = collect(['power', 'torque', 'model_year'])
        ->map(fn (string $key): ?array => collect($card['spec_strip'] ?? [])->first(fn (array $entry): bool => $entry['key'] === $key && $entry['value'] !== null))
        ->filter()
        ->map(fn (array $entry): array => ['value' => $entry['value'], 'unit' => $entry['key'] === 'model_year' ? null : ($entry['unit'] ?? null), 'label' => __('public.card.'.$entry['key'])])
        ->values();
@endphp
<a href="{{ \App\Support\PublicUrl::to('/v/'.$card['slug']) }}" {{ $attributes->class(['sc-focus sc-press block', $garage ? 'rounded-xl sc-title-box' : 'rounded-md']) }} data-testid="{{ $testid }}">
    <span @class(['relative block w-full overflow-hidden bg-surface', $garage ? 'aspect-[4/5] rounded-xl' : 'aspect-[4/3] rounded-md']) data-qa-exempt="photo">
        @if ($card['cover'])
            <x-public.photo :photo="$card['cover']" :sizes="$sizes" :eager="$eager" :alt="$card['cover']['alt'] ?: $card['full_title']" class="absolute inset-0 h-full w-full object-cover" />
        @else
            <span class="absolute inset-0 flex items-center justify-center text-ink-3"><x-public.icon name="device-mobile" :size="24" /></span>
        @endif
        @if ($card['is_main'] || ($card['is_sample'] ?? false))
            <span class="absolute top-12 left-12 flex flex-wrap gap-4">
                @if ($card['is_main'])
                    <span class="inline-flex min-h-20 items-center rounded-xs bg-on-photo-chip px-8 text-label-badge whitespace-nowrap hyphens-none text-on-photo" data-testid="{{ $testid }}.main">{{ __('public.vehicle.main') }}</span>
                @endif
                <x-public.sample-badges :sample="($card['is_sample'] ?? false) === true" :on-photo="true" testid="{{ $testid }}.sample" />
            </span>
        @endif
    </span>
    @if ($garage)
        <x-public.display-title as="span" :text="$card['full_title']" placement="card" :base="true" class="mt-12 block text-ink" data-testid="{{ $testid }}.title" />
        @if ($caption !== '')
            <span class="mt-4 block text-caption text-ink-2">{{ \App\Support\KeepTogether::name($caption) }}</span>
        @endif
        @if ($stats->isNotEmpty())
            <span class="sc-card-stats mt-12" data-testid="{{ $testid }}.spec">
                @foreach ($stats as $stat)
                    <span class="block min-w-0">
                        <span class="flex items-baseline gap-2 whitespace-nowrap"><span class="t-hero-numeral-s text-ink">{{ $stat['value'] }}</span>@if ($stat['unit'])<span class="t-label-unit text-ink-2">{{ $stat['unit'] }}</span>@endif</span>
                        <span class="block truncate t-label-caps text-ink-2">{{ $stat['label'] }}</span>
                    </span>
                @endforeach
            </span>
        @endif
    @else
        <span class="mt-12 block text-headline text-ink">{{ \App\Support\KeepTogether::name($card['full_title']) }}</span>
        @if ($subline !== [])
            <span class="block text-callout text-ink-2">{{ \App\Support\KeepTogether::words(implode(' · ', $subline)) }}</span>
        @endif
        @if ($chips->isNotEmpty())
            <span class="mt-8 flex flex-wrap gap-4">
                @foreach ($chips as $chip)
                    <span class="inline-flex min-h-24 items-center rounded-xs bg-raised px-8 text-caption tabular-nums text-ink">{{ $chip }}</span>
                @endforeach
            </span>
        @endif
    @endif
</a>
