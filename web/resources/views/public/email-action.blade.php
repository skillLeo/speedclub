{{--
    WEB-07 /email/{action} (m2.7-contract §2): action verify | reset. Sessionless. The code and the address come in the fragment (ADR-138),
    which no browser sends: the nonce'd script below copies the fragment onto the links marked data-email-link and clears the address bar.
    Nothing of it reaches the server, a query string or a log. Without JavaScript both links open the screen, where the code from the mail
    can be typed. The app link is marked only when it is a verified https App Link ($appCarriesCode), never on speedclub:// (SEC-P2-03).
    The query left after the controller's redirect is the language and, outside production, the QA overrides; clearing the fragment keeps it.
    "Im Browser fortfahren" is the inverse primary: this page is no brand moment (§3, DQ-426).
--}}
@php
    $body = __('public.email_action.'.$action.'.body', ['minutes' => config()->integer('speedclub.verification.expires_minutes')]);
@endphp
<x-public.layout :title="__('public.email_action.'.$action.'.title').' · SPEED CLUB'" :description="$body" robots="noindex">
    <x-public.top-bar />
    <main id="main" class="sc-form-page flex-1" data-testid="WEB-07.root" data-action="{{ $action }}">
        <div class="sc-form-measure">
            <h1 class="text-title-l text-ink" data-testid="WEB-07.title">{{ __('public.email_action.'.$action.'.title') }}</h1>
            <p class="mt-8 text-body text-ink-2" data-testid="WEB-07.body">{{ $body }}</p>
            <div class="mt-24 flex flex-wrap gap-8">
                <x-public.button :href="$browser" variant="primary" size="l" data-email-link data-testid="WEB-07.browser">{{ __('public.email_action.browser') }}</x-public.button>
                <x-public.button :href="$app" variant="secondary" size="l" :data-email-link="$appCarriesCode" data-testid="WEB-07.app">{{ __('public.email_action.app') }}</x-public.button>
            </div>
            <p class="mt-16 text-supporting text-ink-3" data-testid="WEB-07.hint">{{ __('public.email_action.hint') }}</p>
        </div>
    </main>
    <script nonce="{{ Vite::cspNonce() }}">
        (function () {
            var values = new URLSearchParams(location.hash.replace(/^#/, ''));
            var code = values.getAll('code');
            var email = values.getAll('email');
            if (location.hash) history.replaceState(null, '', location.pathname + location.search);
            if (code.length !== 1 || !/^\d{6}$/.test(code[0])) return;
            var fragment = new URLSearchParams({ code: code[0] });
            if (email.length === 1 && email[0].length <= 254 && /^[^\s@]+@[^\s@]+$/.test(email[0])) fragment.set('email', email[0]);
            document.querySelectorAll('[data-email-link]').forEach(function (link) {
                link.setAttribute('href', link.getAttribute('href').split('#')[0] + '#' + fragment.toString());
            });
        })();
    </script>
</x-public.layout>
