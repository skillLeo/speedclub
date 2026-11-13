@props(['sample' => false, 'editorial' => false, 'onPhoto' => false, 'testid' => 'WEB.sampleBadges'])
{{-- 09 §8.19 (ADR-412): sample content is always recognisable. "Beispiel" on every sample vehicle, member and card, "Editorial" on the SPEED
     CLUB Editorial account. The status pill's neutral role (no red); on a photo the chip of the Hauptfahrzeug badge (neutral, ADR-431 f). --}}
@if ($sample || $editorial)
    <span {{ $attributes->class('flex flex-wrap gap-4') }} data-testid="{{ $testid }}">
        @foreach (array_filter(['sample' => $sample, 'editorial' => $editorial]) as $kind => $shown)
            @if ($onPhoto)
                <span class="inline-flex min-h-20 items-center rounded-xs bg-on-photo-chip px-8 text-label-badge whitespace-nowrap hyphens-none text-on-photo" data-testid="{{ $testid }}.{{ $kind }}">{{ __('public.sample.'.$kind) }}</span>
            @else
                <x-public.status-pill :label="__('public.sample.'.$kind)" data-testid="{{ $testid }}.{{ $kind }}" />
            @endif
        @endforeach
    </span>
@endif
