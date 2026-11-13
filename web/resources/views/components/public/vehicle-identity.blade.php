@props(['vehicle', 'owner' => null, 'onPhoto' => true])
{{-- WEB-01 identity (DQ-1047, 09 §7.6 (2)), the app's VehicleIdentity in the same order under the parity IDs: sample badges → eyebrow →
     4 → display.title (VEH-01.title) → 4 → sub-line → 8 → owner chip (avatar 32 + @handle, VEH-01.ownerRow). On the hero every text
     is onPhoto and starts below the scrim's text-safe line (public.css .sc-hero-identity); without photos it sits on the canvas. --}}
@php
    // One word, as the app sets the handle: never hyphenated, broken only when wider than a whole line (DQ-927).
    $handle = $owner ? \App\Support\KeepTogether::identifier('@'.$owner['username'], false) : null;
@endphp
<div {{ $attributes->class(['sc-title-box', 'sc-veh-identity']) }}>
    @if ($vehicle['is_sample'] ?? false)
        <x-public.sample-badges :sample="true" :editorial="($owner['is_editorial'] ?? false) === true" :on-photo="$onPhoto" class="mb-8" testid="WEB-01.sampleBadges" />
    @endif
    @if ($vehicle['eyebrow'])
        <p class="text-label-caps uppercase {{ $onPhoto ? 'text-on-photo-2' : 'text-ink-2' }}" data-testid="VEH-01.eyebrow">{{ $vehicle['eyebrow'] }}</p>
    @endif
    <x-public.display-title :text="$vehicle['title']" placement="page" class="mt-4 w-fit {{ $onPhoto ? 'text-on-photo' : 'text-ink' }}" data-testid="VEH-01.title" />
    @if ($vehicle['subline_parts'] !== [])
        {{-- DQ-1061 (ADR-424): an engine code never breaks inside; the parts stay whole (KeepTogether::words), no automatic hyphens. --}}
        <p class="sc-ident-line mt-4 text-callout {{ $onPhoto ? 'text-on-photo-2' : 'text-ink-2' }}" data-testid="VEH-01.subline">{{ \App\Support\KeepTogether::words(implode(' · ', $vehicle['subline_parts'])) }}</p>
    @endif
    @if ($owner)
        <a href="{{ \App\Support\PublicUrl::to('/u/'.$owner['username']) }}" class="sc-focus sc-press sc-hero-owner mt-8 {{ $onPhoto ? 'text-on-photo' : 'text-ink' }}" data-testid="VEH-01.ownerRow">
            <x-public.avatar :name="$owner['display_name'] ?: '@'.$owner['username']" :media="$owner['avatar']" :size="32" />
            <span class="min-w-0 truncate text-callout">{{ $handle }}</span>
        </a>
    @endif
</div>
