@props(['signIn' => null])
{{-- FS-10 top bar. "App laden" goes to the honest paragraph on the landing page until WEB-04 exists. At large text it gives way, so the bar stays one line and everything sticky under it stays put.
     The wordmark is 121 CSS px wide: the 242 file is its 2x, the 320 file its 3x (M5 gate LCP: a phone no longer loads 3x before the hero). --}}
<header class="sc-topbar sc-chrome text-body" data-testid="WEB.topBar" data-qa-exempt="safe-area">
    <div class="sc-topbar-row">
        <a href="{{ \App\Support\PublicUrl::to('/') }}" class="sc-focus inline-flex min-h-44 shrink-0 items-center rounded-xs" aria-label="{{ __('public.nav.home') }}" data-testid="WEB.topBar.home">
            <img src="{{ \App\Support\BrandFiles::asset('brand/logo-wide-white-320.webp') }}" srcset="{{ \App\Support\BrandFiles::asset('brand/logo-wide-white-242.webp') }} 242w, {{ \App\Support\BrandFiles::asset('brand/logo-wide-white-320.webp') }} 320w" sizes="121px" alt="" width="121" height="32" loading="lazy" class="sc-logo-on-dark sc-wordmark">
            <img src="{{ \App\Support\BrandFiles::asset('brand/logo-wide-black-320.webp') }}" srcset="{{ \App\Support\BrandFiles::asset('brand/logo-wide-black-242.webp') }} 242w, {{ \App\Support\BrandFiles::asset('brand/logo-wide-black-320.webp') }} 320w" sizes="121px" alt="" width="121" height="32" loading="lazy" class="sc-logo-on-light sc-wordmark">
        </a>
        <div class="flex items-center gap-8">
            {{-- Client round 2: the shop on the website, while the `shop` flag is on (it stays off until the Shopify store is connected). --}}
            @if (app(\App\Services\AppConfig\FeatureFlags::class)->enabled('shop'))
                <a href="{{ url('/app/shop') }}" class="sc-focus sc-topbar-shop min-h-44 items-center rounded-sm px-8 text-callout text-ink-2 hover:text-ink" data-testid="WEB.topBar.shop">{{ __('public.nav.shop') }}</a>
            @endif
            <a href="{{ \App\Support\PublicUrl::to('/').'#app' }}" class="sc-focus sc-topbar-app min-h-44 items-center rounded-sm px-8 text-callout text-ink-2 hover:text-ink" data-testid="WEB.topBar.app">{{ __('public.nav.get_app') }}</a>
            <x-public.button :href="$signIn ?? url('/app/sign-in')" variant="secondary" size="s" data-testid="WEB.topBar.signIn">{{ __('public.nav.sign_in') }}</x-public.button>
        </div>
    </div>
</header>
