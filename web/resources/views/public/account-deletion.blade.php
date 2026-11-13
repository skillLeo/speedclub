{{--
    WEB-05 /konto-loeschen (08_LEGAL_COMPLIANCE §6, m2.5-contract §3). state: form | done. Works without JavaScript and without a session (ADR-115): errors come
    back with the address typed ($old, $errors), never the password. $needsCode shows the two-factor field first; it is always there for whoever knows they need it.
--}}
@php
    $state ??= 'form';
    $old ??= [];
    $needsCode ??= false;
    $bag = isset($errors) && $errors instanceof \Illuminate\Support\MessageBag ? $errors : new \Illuminate\Support\MessageBag;
    $email = is_string($old['email'] ?? null) ? $old['email'] : '';
    $title = $state === 'done' ? __('public.account_deletion.done_title') : __('public.account_deletion.title');
    $turnstile = \App\Services\Support\Turnstile::enabled();
    $describedBy = fn (string $field, bool $hint = false): string => trim(($hint ? 'delete-'.$field.'-hint ' : '').($bag->has($field) ? 'delete-'.$field.'-error' : ''));
@endphp
<x-public.layout :title="$title.' · SPEED CLUB'" :description="__('public.account_deletion.description')" robots="noindex" :canonical="url('/konto-loeschen')">
    @if ($turnstile && $state === 'form')
        @push('sc-preload')
            <script src="{{ \App\Services\Support\Turnstile::SCRIPT_URL }}" async defer nonce="{{ Vite::cspNonce() }}"></script>
        @endpush
    @endif
    <x-public.top-bar />
    <main id="main" class="sc-form-page flex-1" data-testid="WEB-05.root" data-state="{{ $state }}">
        <div class="sc-form-measure">
            @if ($state === 'done')
                <h1 class="t-title-1 text-ink" data-testid="WEB-05.done.title">{{ __('public.account_deletion.done_title') }}</h1>
                <p class="mt-8 text-body text-ink-2" data-testid="WEB-05.done.body">{{ __('public.account_deletion.done_body') }}</p>
                <div class="mt-24 flex flex-wrap gap-8">
                    <x-public.button :href="\App\Support\PublicUrl::to('/')" variant="secondary" size="l" data-testid="WEB-05.done.home">{{ __('public.account_deletion.done_home') }}</x-public.button>
                </div>
            @else
                <h1 class="t-title-1 text-ink" data-testid="WEB-05.title">{{ __('public.account_deletion.title') }}</h1>
                <p class="mt-8 text-body text-ink-2" data-testid="WEB-05.intro">{{ __('public.account_deletion.intro') }}</p>

                <section class="mt-24" aria-labelledby="delete-consequences" data-testid="WEB-05.consequences">
                    <h2 id="delete-consequences" class="text-headline text-ink">{{ __('public.account_deletion.consequences_title') }}</h2>
                    <ul class="mt-8 grid list-disc gap-8 pl-20 text-body text-ink-2">
                        @foreach (__('public.account_deletion.consequences') as $line)
                            <li>{{ $line }}</li>
                        @endforeach
                    </ul>
                </section>

                @if ($bag->isNotEmpty())
                    <div class="sc-form-summary mt-24" role="alert" tabindex="-1" id="delete-errors" data-testid="WEB-05.errors">
                        <p class="text-body-strong text-ink">{{ __('public.forms.errors_title') }}</p>
                        <ul class="mt-8 text-callout text-ink-2">
                            @foreach ($bag->keys() as $field)
                                <li><a class="sc-focus underline" href="#delete-{{ $field === 'form' ? 'submit' : $field }}">{{ $bag->first($field) }}</a></li>
                            @endforeach
                        </ul>
                    </div>
                @endif

                <form method="post" action="{{ \App\Support\PublicUrl::to('/konto-loeschen') }}" class="mt-32 grid gap-24" novalidate data-testid="WEB-05.form">
                    <h2 class="text-headline text-ink">{{ __('public.account_deletion.form_title') }}</h2>

                    <div class="sc-form-field">
                        <label for="delete-email" class="text-callout text-ink-2">{{ __('public.account_deletion.email') }}</label>
                        <input id="delete-email" name="email" type="text" inputmode="email" autocomplete="username" autocapitalize="none" spellcheck="false" required maxlength="255" value="{{ $email }}" class="sc-focus sc-form-input text-input" @if ($describedBy('email') !== '') aria-describedby="{{ $describedBy('email') }}" aria-invalid="true" @endif data-testid="WEB-05.email">
                        @if ($bag->has('email'))
                            <p id="delete-email-error" class="sc-form-error text-caption">{{ $bag->first('email') }}</p>
                        @endif
                    </div>

                    <div class="sc-form-field">
                        <label for="delete-password" class="text-callout text-ink-2">{{ __('public.account_deletion.password') }}</label>
                        <input id="delete-password" name="password" type="password" autocomplete="current-password" required maxlength="255" class="sc-focus sc-form-input text-input" @if ($describedBy('password') !== '') aria-describedby="{{ $describedBy('password') }}" aria-invalid="true" @endif data-testid="WEB-05.password">
                        @if ($bag->has('password'))
                            <p id="delete-password-error" class="sc-form-error text-caption">{{ $bag->first('password') }}</p>
                        @endif
                        <a href="{{ url('/app/forgot-password') }}" class="sc-focus inline-flex min-h-44 items-center justify-self-start text-callout text-ink-2 underline" data-testid="WEB-05.forgot">{{ __('public.account_deletion.forgot') }}</a>
                    </div>

                    <div class="sc-form-field">
                        <label for="delete-code" class="text-callout text-ink-2">{{ __('public.account_deletion.code') }}</label>
                        <p id="delete-code-hint" class="text-caption text-ink-3">{{ __('public.account_deletion.code_hint') }}</p>
                        <input id="delete-code" name="code" type="text" inputmode="text" autocomplete="one-time-code" autocapitalize="characters" spellcheck="false" maxlength="32" class="sc-focus sc-form-input text-input" aria-describedby="{{ $describedBy('code', true) }}" @if ($bag->has('code')) aria-invalid="true" @endif @if ($needsCode) autofocus @endif data-testid="WEB-05.code">
                        @if ($bag->has('code'))
                            <p id="delete-code-error" class="sc-form-error text-caption" data-testid="WEB-05.code.error">{{ $bag->first('code') }}</p>
                        @endif
                    </div>

                    <div class="sc-form-field">
                        <label class="sc-form-option text-body text-ink" for="delete-confirm">
                            <input id="delete-confirm" name="confirm" type="checkbox" value="1" required class="sc-focus sc-form-check" @if ($bag->has('confirm')) aria-invalid="true" aria-describedby="delete-confirm-error" @endif data-testid="WEB-05.confirm">
                            <span>{{ __('public.account_deletion.confirm') }}</span>
                        </label>
                        @if ($bag->has('confirm'))
                            <p id="delete-confirm-error" class="sc-form-error text-caption">{{ $bag->first('confirm') }}</p>
                        @endif
                    </div>

                    @if ($turnstile)
                        <div class="cf-turnstile" data-sitekey="{{ \App\Services\Support\Turnstile::siteKey() }}" data-action="{{ \App\Services\Support\Turnstile::ACTION_ACCOUNT_DELETION }}" data-language="{{ app()->getLocale() }}" data-testid="WEB-05.turnstile"></div>
                    @endif

                    <div>
                        @if ($bag->has('form'))
                            <p id="delete-form-error" class="sc-form-error mb-12 text-caption" data-testid="WEB-05.form.error">{{ $bag->first('form') }}</p>
                        @endif
                        <button id="delete-submit" type="submit" class="sc-focus relative inline-flex min-h-52 items-center justify-center gap-8 rounded-sm bg-accent-fill px-20 py-8 text-center text-body-strong text-on-accent hover:bg-accent-fill-pressed" data-testid="WEB-05.submit">{{ __('public.account_deletion.submit') }}</button>
                    </div>

                    <p class="text-callout text-ink-3">
                        {{ __('public.account_deletion.contact') }}
                        <a class="sc-focus underline text-ink-2" href="{{ \App\Support\PublicUrl::to('/kontakt') }}" data-testid="WEB-05.contact">{{ __('public.contact.title') }}</a>
                    </p>
                </form>
            @endif
        </div>
    </main>
</x-public.layout>
