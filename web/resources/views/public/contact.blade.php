{{--
    WEB-10 /kontakt (m2.5-contract §4). state: form | sent. Works without JavaScript and without a session (ADR-115): errors come back with what was typed.
    A guest ticket for ADM-25. Reports of content go to WEB-09 /melden instead.
--}}
@php
    $state ??= 'form';
    $old ??= [];
    $bag = isset($errors) && $errors instanceof \Illuminate\Support\MessageBag ? $errors : new \Illuminate\Support\MessageBag;
    $value = fn (string $key): string => is_string($old[$key] ?? null) ? $old[$key] : '';
    $max = config()->integer('speedclub.support.message_max_length');
    $title = $state === 'sent' ? __('public.contact.sent_title') : __('public.contact.title');
    $turnstile = \App\Services\Support\Turnstile::enabled();
    $describedBy = fn (string $field, bool $hint = false): string => trim(($hint ? 'contact-'.$field.'-hint ' : '').($bag->has($field) ? 'contact-'.$field.'-error' : ''));
@endphp
<x-public.layout :title="$title.' · SPEED CLUB'" :description="__('public.contact.description')" :canonical="url('/kontakt')">
    @if ($turnstile && $state === 'form')
        @push('sc-preload')
            <script src="{{ \App\Services\Support\Turnstile::SCRIPT_URL }}" async defer nonce="{{ Vite::cspNonce() }}"></script>
        @endpush
    @endif
    <x-public.top-bar />
    <main id="main" class="sc-form-page flex-1" data-testid="WEB-10.root" data-state="{{ $state }}">
        <div class="sc-form-measure">
            @if ($state === 'sent')
                <h1 class="text-title-l text-ink" data-testid="WEB-10.sent.title">{{ __('public.contact.sent_title') }}</h1>
                <p class="mt-8 text-body text-ink-2" data-testid="WEB-10.sent.body">{{ __('public.contact.sent_body', ['reference' => $reference ?? '']) }}</p>
                <div class="mt-24 flex flex-wrap gap-8">
                    <x-public.button :href="\App\Support\PublicUrl::to('/')" variant="secondary" size="l" data-testid="WEB-10.sent.home">{{ __('public.contact.sent_home') }}</x-public.button>
                </div>
            @else
                <h1 class="text-title-l text-ink" data-testid="WEB-10.title">{{ __('public.contact.title') }}</h1>
                <p class="mt-8 text-body text-ink-2" data-testid="WEB-10.intro">{{ __('public.contact.intro') }}</p>
                <p class="mt-8 text-supporting text-ink-3" data-testid="WEB-10.reportHint">
                    {{ __('public.contact.report_hint') }}
                    <a class="sc-focus underline text-ink-2" href="{{ \App\Support\PublicUrl::to('/melden') }}" data-testid="WEB-10.report">{{ __('public.contact.report_link') }}</a>
                </p>

                @if ($bag->isNotEmpty())
                    <div class="sc-form-summary mt-24" role="alert" tabindex="-1" id="contact-errors" data-testid="WEB-10.errors">
                        <p class="text-body-strong text-ink">{{ __('public.forms.errors_title') }}</p>
                        <ul class="mt-8 text-supporting text-ink-2">
                            @foreach ($bag->keys() as $field)
                                <li><a class="sc-focus underline" href="#contact-{{ $field === 'form' ? 'submit' : $field }}">{{ $bag->first($field) }}</a></li>
                            @endforeach
                        </ul>
                    </div>
                @endif

                <form method="post" action="{{ \App\Support\PublicUrl::to('/kontakt') }}" class="mt-24 grid gap-24" novalidate data-testid="WEB-10.form">
                    <div class="sc-form-field">
                        <label for="contact-name" class="text-label-s text-ink-2">{{ __('public.contact.name') }}</label>
                        <input id="contact-name" name="name" type="text" autocomplete="name" required maxlength="80" value="{{ $value('name') }}" class="sc-focus sc-form-input text-body" @if ($bag->has('name')) aria-invalid="true" aria-describedby="contact-name-error" @endif data-testid="WEB-10.name">
                        @if ($bag->has('name'))
                            <p id="contact-name-error" class="sc-form-error text-helper">{{ $bag->first('name') }}</p>
                        @endif
                    </div>

                    <div class="sc-form-field">
                        <label for="contact-email" class="text-label-s text-ink-2">{{ __('public.contact.email') }}</label>
                        <p id="contact-email-hint" class="text-helper text-ink-3">{{ __('public.contact.email_hint') }}</p>
                        <input id="contact-email" name="email" type="text" inputmode="email" autocomplete="email" autocapitalize="none" spellcheck="false" required maxlength="255" value="{{ $value('email') }}" class="sc-focus sc-form-input text-body" aria-describedby="{{ $describedBy('email', true) }}" @if ($bag->has('email')) aria-invalid="true" @endif data-testid="WEB-10.email">
                        @if ($bag->has('email'))
                            <p id="contact-email-error" class="sc-form-error text-helper">{{ $bag->first('email') }}</p>
                        @endif
                    </div>

                    <div class="sc-form-field">
                        <label for="contact-category" class="text-label-s text-ink-2">{{ __('public.contact.category') }}</label>
                        <div class="sc-form-select-wrap">
                            <select id="contact-category" name="category" required class="sc-focus sc-form-input sc-form-select text-body" @if ($bag->has('category')) aria-invalid="true" aria-describedby="contact-category-error" @endif data-testid="WEB-10.category">
                                <option value="">{{ __('public.contact.category_choose') }}</option>
                                @foreach (\App\Enums\SupportCategory::cases() as $category)
                                    <option value="{{ $category->value }}" @selected($value('category') === $category->value)>{{ $category->label() }}</option>
                                @endforeach
                            </select>
                            <x-public.icon name="caret-right" :size="20" class="sc-form-select-caret" />
                        </div>
                        @if ($bag->has('category'))
                            <p id="contact-category-error" class="sc-form-error text-helper">{{ $bag->first('category') }}</p>
                        @endif
                    </div>

                    <div class="sc-form-field">
                        <label for="contact-message" class="text-label-s text-ink-2">{{ __('public.contact.message') }}</label>
                        <p id="contact-message-hint" class="text-helper text-ink-3">{{ __('public.contact.message_hint', ['max' => $max]) }}</p>
                        <textarea id="contact-message" name="message" rows="6" required minlength="10" maxlength="{{ $max }}" class="sc-focus sc-form-input sc-form-textarea text-body" aria-describedby="{{ $describedBy('message', true) }}" @if ($bag->has('message')) aria-invalid="true" @endif data-testid="WEB-10.message">{{ $value('message') }}</textarea>
                        @if ($bag->has('message'))
                            <p id="contact-message-error" class="sc-form-error text-helper">{{ $bag->first('message') }}</p>
                        @endif
                    </div>

                    @if ($turnstile)
                        <div class="cf-turnstile" data-sitekey="{{ \App\Services\Support\Turnstile::siteKey() }}" data-action="{{ \App\Services\Support\Turnstile::ACTION_CONTACT }}" data-language="{{ app()->getLocale() }}" data-testid="WEB-10.turnstile"></div>
                    @endif

                    <p class="text-supporting text-ink-3" data-testid="WEB-10.privacy">
                        {{ __('public.contact.privacy') }} <a class="sc-focus underline text-ink-2" href="{{ \App\Support\PublicUrl::to('/datenschutz') }}">{{ __('public.forms.privacy_link') }}</a>.
                    </p>

                    <div>
                        @if ($bag->has('form'))
                            <p id="contact-form-error" class="sc-form-error mb-12 text-helper" data-testid="WEB-10.form.error">{{ $bag->first('form') }}</p>
                        @endif
                        <button id="contact-submit" type="submit" class="sc-focus relative inline-flex min-h-52 items-center justify-center gap-8 rounded-sm bg-inverse px-20 py-8 text-center text-label text-ink-inverse" data-testid="WEB-10.submit">{{ __('public.contact.submit') }}</button>
                    </div>
                </form>
            @endif
        </div>
    </main>
</x-public.layout>
