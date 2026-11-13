@props(['links', 'testid' => 'WEB-01.openInApp', 'label' => null, 'variant' => 'brand'])
{{-- Without JavaScript and without a store listing: the member web app. resources/js/public/app.ts upgrades it to the installed app or the store (F4).
     M4.16: `variant` secondary where the page already has its one filled CTA (Folgen on WEB-01/02, DQ-919); `label` for the page's own verb. --}}
<x-public.button
    :href="$links['web_app']"
    :variant="$variant"
    size="l"
    {{ $attributes }}
    data-testid="{{ $testid }}"
    data-open-app
    data-deep-link="{{ $links['deep_link'] }}"
    data-store-ios="{{ $links['store_ios'] }}"
    data-store-android="{{ $links['store_android'] }}"
>{{ $label ?? __('public.vehicle.open_in_app') }}</x-public.button>
