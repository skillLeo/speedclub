@props(['links', 'testid' => 'WEB-01.stickyBar', 'openLabel' => null, 'quiet' => false])
{{-- FS-10 bottom bar. In the flow and sticky, so it takes its own height at any text size and stops above the footer instead of covering it.
     M4.16 (09 §9): "In der App öffnen" + "Kostenlos beitreten". `quiet` where the page has its own filled CTA (Folgen, DQ-919): then the
     bar holds two secondary buttons. A page may put its own second action into the slot (WEB-09: In Kalender). --}}
<aside class="sc-sticky-cta sc-chrome" aria-label="{{ __('public.vehicle.cta_label') }}" data-testid="{{ $testid }}" data-qa-exempt="safe-area">
    @if ($links['web_app'] !== null)
        <x-public.open-in-app :links="$links" :label="$openLabel" :variant="$quiet ? 'secondary' : 'brand'" class="sc-grow" />
    @endif
    @if ($slot->isEmpty())
        <x-public.button :href="$links['register']" variant="secondary" size="l" class="sc-grow" data-testid="WEB-01.register">{{ __('public.vehicle.register') }}</x-public.button>
    @else
        {{ $slot }}
    @endif
</aside>
