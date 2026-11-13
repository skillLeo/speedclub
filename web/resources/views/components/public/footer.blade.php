{{--
    On every public page. "Kontakt" (WEB-10) and "Konto löschen" (WEB-05, Google Play's web deletion link) since M2.5, "App laden" (WEB-04) since
    M2.7 (ADR-148 h lifts).
    Language by link, not by cookie: a guest gets none (ADR-115). The theme buttons only exist with JavaScript, because only JavaScript can act on them.
--}}
@php
    $themes = ['carbon', 'black', 'light', 'system'];
    $links = ['imprint' => '/impressum', 'privacy' => '/datenschutz', 'terms' => '/agb', 'community' => '/community-richtlinien', 'report' => '/melden', 'contact' => '/kontakt', 'delete_account' => '/konto-loeschen', 'get_app' => '/app-laden'];
@endphp
<footer class="sc-footer" data-testid="WEB.footer" data-qa-exempt="safe-area">
    <div class="sc-footer-grid">
        <div>
            <img src="{{ asset('brand/logo-wide-white-320.webp') }}" alt="SPEED CLUB" width="107" height="32" loading="lazy" class="sc-logo-on-dark sc-wordmark">
            <img src="{{ asset('brand/logo-wide-black-320.webp') }}" alt="SPEED CLUB" width="107" height="32" loading="lazy" class="sc-logo-on-light sc-wordmark">
            <p class="mt-8 text-caption text-ink-3">Cars. People. Culture.</p>
        </div>
        <nav aria-label="{{ __('public.footer.label') }}" class="sc-footer-links">
            @foreach ($links as $key => $path)
                <a href="{{ \App\Support\PublicUrl::to($path) }}" class="sc-focus inline-flex min-h-44 min-w-44 items-center justify-center rounded-xs text-callout text-ink-2 hover:text-ink" data-testid="WEB.footer.{{ $key }}">{{ __('public.footer.'.$key) }}</a>
            @endforeach
        </nav>
        <div class="sc-footer-prefs">
            <div class="flex flex-wrap items-center gap-4" role="group" aria-label="{{ __('public.footer.language') }}">
                @foreach (config('speedclub.locales') as $language)
                    <a
                        href="{{ request()->fullUrlWithQuery(['lang' => $language]) }}"
                        hreflang="{{ $language }}"
                        lang="{{ $language }}"
                        @if (app()->getLocale() === $language) aria-current="true" @endif
                        class="sc-focus sc-seg text-callout"
                        data-testid="WEB.footer.lang.{{ $language }}"
                    >{{ strtoupper($language) }}</a>
                @endforeach
            </div>
            <div class="sc-js-flex flex-wrap items-center gap-4" role="group" aria-label="{{ __('public.footer.theme') }}" data-theme-picker>
                @foreach ($themes as $theme)
                    <button type="button" class="sc-focus sc-seg text-callout" data-theme-value="{{ $theme }}" aria-pressed="false" data-testid="WEB.footer.theme.{{ $theme }}">{{ __('public.footer.theme_'.$theme) }}</button>
                @endforeach
            </div>
        </div>
    </div>
</footer>
