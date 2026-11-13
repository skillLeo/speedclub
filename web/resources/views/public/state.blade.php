{{--
    WEB-06 and its siblings: one line of what happened, a way forward, never anything about the vehicle behind a revoked or private code.
    state: revoked | private | not_found (WEB-06) · vehicle_unavailable · member_unavailable · business_unavailable · event_unavailable · brand_unavailable · not_published · rate_limited · page_not_found · server_error · maintenance
    copy: for WEB-06, the text under public.qr_state (QrResolution::copy); a revoked code of a deleted vehicle reads "unavailable"
--}}
@php
    $isQr = in_array($state, ['revoked', 'private', 'not_found'], true);
    $key = $isQr ? ($copy ?? $state) : $state;
    $title = $isQr ? __('public.qr_state.'.$key.'.title') : __('public.state.'.$key.'.title');
    $text = $body ?? ($isQr ? __('public.qr_state.'.$key.'.body') : __('public.state.'.$key.'.body'));
    $id = $isQr ? 'WEB-06' : 'WEB-STATE';
    // DQ-172: one glyph per state, the same in the app (QrResolveScreen). What is gone reads like private, who cannot be found like not found.
    $icon = ['revoked' => 'prohibit', 'private' => 'lock-simple', 'not_found' => 'magnifying-glass', 'vehicle_unavailable' => 'lock-simple', 'member_unavailable' => 'magnifying-glass', 'business_unavailable' => 'lock-simple', 'event_unavailable' => 'lock-simple', 'brand_unavailable' => 'magnifying-glass'][$state] ?? 'compass';
    $photo = \App\Services\PublicPages\PublicPhoto::brand('state-garage');
@endphp
<x-public.layout :title="$title.' · SPEED CLUB'" :description="$text" robots="noindex">
    <x-public.top-bar />
    <main id="main" class="sc-state flex-1" data-testid="{{ $id }}.root" data-state="{{ $state }}">
        <div class="sc-state-photo" data-qa-exempt="photo">
            <x-public.photo :photo="$photo" sizes="(min-width: 1280px) 50vw, 100vw" alt="" :priority="true" class="h-full w-full object-cover" />
        </div>
        <div class="sc-state-copy">
            <div class="sc-state-measure">
                <x-public.icon :name="$icon" :size="24" class="text-ink-2" />
                <h1 class="mt-12 t-title-1 text-ink" data-testid="{{ $id }}.title">{{ $title }}</h1>
                <p class="mt-8 text-body text-ink-2" data-testid="{{ $id }}.body">{{ $text }}</p>
                <div class="mt-24 flex flex-wrap gap-8">
                    <x-public.button :href="url('/app/discover')" variant="primary" size="l" data-testid="{{ $id }}.discover">{{ __('public.state.discover') }}</x-public.button>
                    <x-public.button :href="\App\Support\PublicUrl::to('/')" variant="secondary" size="l" data-testid="{{ $id }}.home">{{ __('public.state.home') }}</x-public.button>
                </div>
            </div>
        </div>
    </main>
</x-public.layout>
