{{--
    WEB-09 /melden (DSA Art. 16, m2.6-contract §3). state: form | sent. Without JavaScript the whole form works; the sub-reason select is always there and
    says it only applies to illegal content. Errors come back with what was typed ($old, $errors from ReportFormRequest), a summary at the top that names
    each field, and aria-describedby on every field. No session (ADR-115): nothing is flashed, the confirmation is its own page.
--}}
@php
    $state ??= 'form';
    $old ??= [];
    /** @var \Illuminate\Support\MessageBag|null $errors */
    $bag = isset($errors) && $errors instanceof \Illuminate\Support\MessageBag ? $errors : new \Illuminate\Support\MessageBag;
    $value = fn (string $key): string => is_string($old[$key] ?? null) ? $old[$key] : '';
    $max = config()->integer('speedclub.moderation.details_max_length');
    $reasons = \App\Enums\ReportReason::cases();
    $subReasons = \App\Enums\IllegalSubReason::cases();
    $example = rtrim(config('app.url'), '/').'/v/…';
    $title = $state === 'sent' ? __('safety.sent.title') : __('safety.form.title');
    $describedBy = fn (string $field, bool $hint = true): string => trim(($hint ? 'report-'.$field.'-hint ' : '').($bag->has($field) ? 'report-'.$field.'-error' : ''));
    $turnstile = \App\Services\Support\Turnstile::siteKey() !== null && \App\Services\Support\Turnstile::enabled();
@endphp
<x-public.layout :title="$title.' · SPEED CLUB'" :description="__('safety.form.description')" robots="noindex" :canonical="url('/melden')">
    @if ($turnstile && $state === 'form')
        @push('sc-preload')
            <script src="{{ \App\Services\Support\Turnstile::SCRIPT_URL }}" async defer nonce="{{ Vite::cspNonce() }}"></script>
        @endpush
    @endif
    <x-public.top-bar />
    <main id="main" class="sc-form-page flex-1" data-testid="WEB-09.root" data-state="{{ $state }}">
        @if ($state === 'sent')
            <div class="sc-form-measure">
                <h1 class="text-title-l text-ink" data-testid="WEB-09.sent.title">{{ __('safety.sent.title') }}</h1>
                <p class="mt-8 text-body text-ink-2" data-testid="WEB-09.sent.body">{{ __('safety.sent.body') }}</p>
                <div class="mt-24 flex flex-wrap gap-8">
                    <x-public.button :href="\App\Support\PublicUrl::to('/melden')" variant="secondary" size="l" data-testid="WEB-09.sent.again">{{ __('safety.sent.again') }}</x-public.button>
                    <x-public.button :href="\App\Support\PublicUrl::to('/')" variant="tertiary" size="l" data-testid="WEB-09.sent.home">{{ __('safety.sent.home') }}</x-public.button>
                </div>
            </div>
        @else
            <div class="sc-form-measure">
                <h1 class="text-title-l text-ink" data-testid="WEB-09.title">{{ __('safety.form.title') }}</h1>
                <p class="mt-8 text-body text-ink-2" data-testid="WEB-09.intro">{{ __('safety.form.intro') }}</p>
                <p class="mt-8 text-supporting text-ink-3" data-testid="WEB-09.appHint">{{ __('safety.form.app_hint') }}</p>

                @if ($bag->isNotEmpty())
                    <div class="sc-form-summary mt-24" role="alert" tabindex="-1" id="report-errors" data-testid="WEB-09.errors">
                        <p class="text-body-strong text-ink">{{ __('safety.form.errors_title') }}</p>
                        <ul class="mt-8 text-supporting text-ink-2">
                            @foreach ($bag->keys() as $field)
                                <li><a class="sc-focus underline" href="#report-{{ $field === 'form' ? 'submit' : $field }}">{{ $bag->first($field) }}</a></li>
                            @endforeach
                        </ul>
                    </div>
                @endif

                <form method="post" action="{{ \App\Support\PublicUrl::to('/melden') }}" class="mt-24 grid gap-24" novalidate data-testid="WEB-09.form">
                    <div class="sc-form-field">
                        <label for="report-url" class="text-label-s text-ink-2">{{ __('safety.form.url') }}</label>
                        <p id="report-url-hint" class="text-helper text-ink-3">{{ __('safety.form.url_hint', ['example' => $example]) }}</p>
                        <input id="report-url" name="url" type="url" inputmode="url" autocomplete="off" required maxlength="2048" value="{{ $value('url') }}" class="sc-focus sc-form-input text-body" aria-describedby="{{ $describedBy('url') }}" @if ($bag->has('url')) aria-invalid="true" @endif data-testid="WEB-09.url">
                        @if ($bag->has('url'))
                            <p id="report-url-error" class="sc-form-error text-helper" data-testid="WEB-09.url.error">{{ $bag->first('url') }}</p>
                        @endif
                    </div>

                    <fieldset class="sc-form-field" aria-describedby="{{ $describedBy('reason') }}" id="report-reason">
                        <legend class="text-label-s text-ink-2">{{ __('safety.form.reason') }}</legend>
                        <p id="report-reason-hint" class="text-helper text-ink-3">{{ __('safety.form.reason_hint') }}</p>
                        <div class="sc-form-options">
                            @foreach ($reasons as $reason)
                                <label class="sc-form-option text-body text-ink">
                                    <input type="radio" name="reason" value="{{ $reason->value }}" class="sc-focus sc-form-radio" @checked($value('reason') === $reason->value) required data-testid="WEB-09.reason.{{ $reason->value }}">
                                    <span>{{ __('safety.reasons.'.$reason->value) }}</span>
                                </label>
                            @endforeach
                        </div>
                        @if ($bag->has('reason'))
                            <p id="report-reason-error" class="sc-form-error text-helper">{{ $bag->first('reason') }}</p>
                        @endif
                    </fieldset>

                    <div class="sc-form-field">
                        <label for="report-sub_reason" class="text-label-s text-ink-2">{{ __('safety.form.sub_reason') }}</label>
                        <p id="report-sub_reason-hint" class="text-helper text-ink-3">{{ __('safety.form.sub_reason_hint') }}</p>
                        <div class="sc-form-select-wrap">
                            <select id="report-sub_reason" name="sub_reason" class="sc-focus sc-form-input sc-form-select text-body" aria-describedby="{{ $describedBy('sub_reason') }}" @if ($bag->has('sub_reason')) aria-invalid="true" @endif data-testid="WEB-09.subReason">
                                <option value="">{{ __('safety.form.sub_reason_none') }}</option>
                                @foreach ($subReasons as $sub)
                                    <option value="{{ $sub->value }}" @selected($value('sub_reason') === $sub->value)>{{ __('safety.sub_reasons.'.$sub->value) }}</option>
                                @endforeach
                            </select>
                            <x-public.icon name="caret-right" :size="20" class="sc-form-select-caret" />
                        </div>
                        @if ($bag->has('sub_reason'))
                            <p id="report-sub_reason-error" class="sc-form-error text-helper">{{ $bag->first('sub_reason') }}</p>
                        @endif
                    </div>

                    <div class="sc-form-field">
                        <label for="report-details" class="text-label-s text-ink-2">{{ __('safety.form.details') }}</label>
                        <p id="report-details-hint" class="text-helper text-ink-3">{{ __('safety.form.details_hint', ['max' => $max]) }}</p>
                        <textarea id="report-details" name="details" rows="6" required maxlength="{{ $max }}" class="sc-focus sc-form-input sc-form-textarea text-body" aria-describedby="{{ $describedBy('details') }}" @if ($bag->has('details')) aria-invalid="true" @endif data-testid="WEB-09.details">{{ $value('details') }}</textarea>
                        @if ($bag->has('details'))
                            <p id="report-details-error" class="sc-form-error text-helper">{{ $bag->first('details') }}</p>
                        @endif
                    </div>

                    <fieldset class="sc-form-field" aria-describedby="report-contact-hint">
                        <legend class="text-label-s text-ink-2">{{ __('safety.form.contact') }}</legend>
                        <p id="report-contact-hint" class="text-helper text-ink-3">{{ __('safety.form.contact_hint') }}</p>
                        <label for="report-name" class="mt-8 text-label-s text-ink-2">{{ __('safety.form.name') }}</label>
                        <input id="report-name" name="name" type="text" autocomplete="name" maxlength="100" value="{{ $value('name') }}" class="sc-focus sc-form-input text-body" @if ($bag->has('name')) aria-invalid="true" aria-describedby="report-name-error" @endif data-testid="WEB-09.name">
                        @if ($bag->has('name'))
                            <p id="report-name-error" class="sc-form-error text-helper">{{ $bag->first('name') }}</p>
                        @endif
                        <label for="report-email" class="mt-8 text-label-s text-ink-2">{{ __('safety.form.email') }}</label>
                        <input id="report-email" name="email" type="email" autocomplete="email" inputmode="email" maxlength="254" value="{{ $value('email') }}" class="sc-focus sc-form-input text-body" @if ($bag->has('email')) aria-invalid="true" aria-describedby="report-email-error" @endif data-testid="WEB-09.email">
                        @if ($bag->has('email'))
                            <p id="report-email-error" class="sc-form-error text-helper">{{ $bag->first('email') }}</p>
                        @endif
                    </fieldset>

                    <div class="sc-form-field">
                        <label class="sc-form-option text-body text-ink" for="report-good_faith">
                            <input id="report-good_faith" name="good_faith" type="checkbox" value="1" required class="sc-focus sc-form-check" @checked($value('good_faith') !== '') @if ($bag->has('good_faith')) aria-invalid="true" aria-describedby="report-good_faith-error" @endif data-testid="WEB-09.goodFaith">
                            <span>{{ __('safety.form.good_faith') }}</span>
                        </label>
                        @if ($bag->has('good_faith'))
                            <p id="report-good_faith-error" class="sc-form-error text-helper">{{ $bag->first('good_faith') }}</p>
                        @endif
                    </div>

                    @if ($turnstile)
                        <div class="cf-turnstile" data-sitekey="{{ \App\Services\Support\Turnstile::siteKey() }}" data-action="{{ \App\Services\Support\Turnstile::ACTION_REPORT }}" data-language="{{ app()->getLocale() }}" data-testid="WEB-09.turnstile"></div>
                    @endif

                    <p class="text-supporting text-ink-3">
                        {{ __('safety.form.privacy') }} <a class="sc-focus underline text-ink-2" href="{{ \App\Support\PublicUrl::to('/datenschutz') }}" data-testid="WEB-09.privacy">{{ __('safety.form.privacy_link') }}</a>.
                    </p>

                    <div>
                        @if ($bag->has('form'))
                            <p id="report-form-error" class="sc-form-error mb-12 text-helper" data-testid="WEB-09.form.error">{{ $bag->first('form') }}</p>
                        @endif
                        <button id="report-submit" type="submit" class="sc-focus relative inline-flex min-h-52 items-center justify-center gap-8 rounded-sm bg-inverse px-20 py-8 text-center text-label text-ink-inverse" data-testid="WEB-09.submit">{{ __('safety.form.submit') }}</button>
                    </div>
                </form>
            </div>
        @endif
    </main>
</x-public.layout>
