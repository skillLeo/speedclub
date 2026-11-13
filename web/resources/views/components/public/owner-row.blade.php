@props(['owner', 'links', 'testid' => 'VEH-01.ownerRow'])
{{-- FS-3 owner row. A guest has neither follow nor message, so both (in the action row under it) lead to the sign-in, which brings them back through next=. In a narrow row the actions sit under the name (OwnerRow.tsx).
     The identity link is OwnerRow.tsx's box: 8 of padding for the focus ring and the hover/pressed fills, given back by a -8 margin, so the row keeps
     the height of its content (avatar 40, name + meta 42) and the target is 58 high (> 44) without pushing the actions down (parity with VEH-01).
     As in the app's RowBody, the ring is drawn inside the box (public.css .sc-owner-id: 2 ring at -4 offset), so it keeps 6 from the Follow button
     (the box ends 4 before it) and never touches it. --}}
@php
    $name = $owner['display_name'] ?: '@'.$owner['username'];
    // One word, as OwnerRow.tsx sets the handle: never hyphenated, broken only when wider than a whole line (DQ-927).
    $handle = \App\Support\KeepTogether::identifier('@'.$owner['username'], false);
@endphp
<div {{ $attributes->class('sc-owner-box text-body') }}>
    <div class="sc-owner" data-testid="{{ $testid }}">
        <a href="{{ \App\Support\PublicUrl::to('/u/'.$owner['username']) }}" class="sc-focus sc-owner-id -m-8 flex min-w-0 items-center gap-12 rounded-sm p-8" data-testid="{{ $testid }}.identity">
            <x-public.avatar :name="$name" :media="$owner['avatar']" :size="40" />
            <span class="min-w-0">
                {{-- DQ-926/927: a name keeps its in-word hyphens, the handle is shown as it is and never hyphenated (KeepTogether). --}}
                <span class="block text-body-strong text-ink">{{ $owner['display_name'] ? \App\Support\KeepTogether::words($owner['display_name']) : $handle }}</span>
                <span class="block text-callout text-ink-2">{{ $handle }}{{ $owner['city'] ? ' · '.$owner['city'] : '' }}</span>
            </span>
        </a>
    </div>
    {{-- M4.9 (09 §7.6 (4), DQ-919/972): the owner row is the identity only, as VEH-01's; Folgen (the one filled control) and Nachricht
         follow under it. The test IDs stay those of M1.6 (PublicPagesRenderTest, f-web02-actions). --}}
    <div class="sc-veh-actions mt-16 flex flex-wrap items-center gap-8" data-testid="WEB-01.actions">
        <x-public.button :href="$links['sign_in']" variant="primary" data-testid="{{ $testid }}.follow">{{ __('public.vehicle.follow') }}</x-public.button>
        <x-public.button :href="$links['sign_in']" variant="secondary" data-testid="{{ $testid }}.message">{{ __('public.vehicle.message') }}</x-public.button>
    </div>
</div>
