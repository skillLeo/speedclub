@props(['signIn' => null])
{{-- FS-10 top bar. "App laden" goes to the honest paragraph on the landing page until WEB-04 exists. At large text it gives way, so the bar stays one line and everything sticky under it stays put. --}}
<header class="sc-topbar text-body" data-testid="WEB.topBar" data-qa-exempt="safe-area">
    <div class="sc-topbar-row">
        <a href="{{ \App\Support\PublicUrl::to('/') }}" class="sc-focus inline-flex min-h-44 shrink-0 items-center rounded-xs" aria-label="{{ __('public.nav.home') }}" data-testid="WEB.topBar.home">
            <img src="{{ asset('brand/logo-wide-white-320.webp') }}" alt="" width="107" height="32" loading="lazy" class="sc-logo-on-dark sc-wordmark">
            <img src="{{ asset('brand/logo-wide-black-320.webp') }}" alt="" width="107" height="32" loading="lazy" class="sc-logo-on-light sc-wordmark">
        </a>
        <div class="flex items-center gap-8">
            <a href="{{ \App\Support\PublicUrl::to('/').'#app' }}" class="sc-focus sc-topbar-app min-h-44 items-center rounded-sm px-8 text-label-s text-ink-2 hover:text-ink" data-testid="WEB.topBar.app">{{ __('public.nav.get_app') }}</a>
            <x-public.button :href="$signIn ?? url('/app/sign-in')" variant="secondary" size="s" data-testid="WEB.topBar.signIn">{{ __('public.nav.sign_in') }}</x-public.button>
        </div>
    </div>
</header>
