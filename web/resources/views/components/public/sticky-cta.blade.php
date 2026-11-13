@props(['links'])
{{-- FS-10 bottom bar. In the flow and sticky, so it takes its own height at any text size and stops above the footer instead of covering it. --}}
<aside class="sc-sticky-cta sc-chrome" aria-label="{{ __('public.vehicle.cta_label') }}" data-testid="WEB-01.stickyBar" data-qa-exempt="safe-area">
    @if ($links['web_app'] !== null)
        <x-public.open-in-app :links="$links" class="sc-grow" />
    @endif
    <x-public.button :href="$links['register']" variant="secondary" size="l" class="sc-grow" data-testid="WEB-01.register">{{ __('public.vehicle.register') }}</x-public.button>
</aside>
