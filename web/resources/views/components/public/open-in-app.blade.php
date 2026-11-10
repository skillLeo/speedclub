@props(['links', 'testid' => 'WEB-01.openInApp'])
{{-- Without JavaScript and without a store listing: the member web app. resources/js/public/app.ts upgrades it to the installed app or the store (F4). --}}
<x-public.button
    :href="$links['web_app']"
    variant="brand"
    size="l"
    {{ $attributes }}
    data-testid="{{ $testid }}"
    data-open-app
    data-deep-link="{{ $links['deep_link'] }}"
    data-store-ios="{{ $links['store_ios'] }}"
    data-store-android="{{ $links['store_android'] }}"
>{{ __('public.vehicle.open_in_app') }}</x-public.button>
