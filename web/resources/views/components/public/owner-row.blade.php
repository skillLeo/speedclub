@props(['owner', 'links', 'testid' => 'VEH-01.ownerRow'])
{{-- FS-3 owner row. A guest has neither follow nor message, so both lead to the sign-in, which brings them back through next=. In a narrow row the actions sit under the name (OwnerRow.tsx). --}}
@php
    $name = $owner['display_name'] ?: '@'.$owner['username'];
    $meta = '@'.$owner['username'].($owner['city'] ? ' · '.$owner['city'] : '');
@endphp
<div {{ $attributes->class('sc-owner-box text-body') }}>
    <div class="sc-owner" data-testid="{{ $testid }}">
        <a href="{{ \App\Support\PublicUrl::to('/u/'.$owner['username']) }}" class="sc-focus sc-owner-id flex min-h-44 min-w-0 items-center gap-12 rounded-sm" data-testid="{{ $testid }}.identity">
            <x-public.avatar :name="$name" :media="$owner['avatar']" :size="40" />
            <span class="min-w-0">
                <span class="block text-body-strong text-ink">{{ $name }}</span>
                <span class="block text-supporting text-ink-2">{{ $meta }}</span>
            </span>
        </a>
        <div class="flex flex-wrap items-center gap-8" data-testid="{{ $testid }}.actions">
            <x-public.button :href="$links['sign_in']" variant="secondary" data-testid="{{ $testid }}.follow">{{ __('public.vehicle.follow') }}</x-public.button>
            <x-public.button :href="$links['sign_in']" variant="primary" data-testid="{{ $testid }}.message">{{ __('public.vehicle.message') }}</x-public.button>
        </div>
    </div>
</div>
