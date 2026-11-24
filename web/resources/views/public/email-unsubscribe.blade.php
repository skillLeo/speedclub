{{--
    WEB-UNSUB (M5.6): unsubscribe page of an e-mail the member opted into. step: ask (GET, changes nothing) · done (after the POST) · gone
    (changed or expired link). The form posts to the same signed URL; the page sets no cookie and needs no JavaScript.
--}}
@php
    $copy = 'public.unsubscribe.lists.'.$list;
    $title = match ($step) {
        'done' => __($copy.'.done_title'),
        'gone' => __('public.unsubscribe.gone_title'),
        default => __($copy.'.ask_title'),
    };
    $text = match ($step) {
        'done' => __($copy.'.done_body'),
        'gone' => __('public.unsubscribe.gone_body'),
        default => __($copy.'.ask_body'),
    };
    // The page is about the meets e-mail: the meet glyph; a dead link reads like any refused page.
    $icon = $step === 'gone' ? 'prohibit' : 'meet';
    $photo = \App\Services\PublicPages\PublicPhoto::brand('state-garage');
@endphp
<x-public.layout :title="__('public.unsubscribe.meta_title')" :description="$text" robots="noindex">
    <x-public.top-bar />
    <main id="main" class="sc-state flex-1" data-testid="WEB-UNSUB.root" data-step="{{ $step }}">
        <div class="sc-state-photo" data-qa-exempt="photo">
            <x-public.photo :photo="$photo" sizes="(min-width: 1280px) 50vw, 100vw" alt="" :priority="true" class="h-full w-full object-cover" />
        </div>
        <div class="sc-state-copy">
            <div class="sc-state-measure">
                <x-public.icon :name="$icon" :size="24" class="text-ink-2" />
                <h1 class="mt-12 t-title-1 text-ink" data-testid="WEB-UNSUB.title">{{ $title }}</h1>
                <p class="mt-8 text-body text-ink-2" data-testid="WEB-UNSUB.body">{{ $text }}</p>
                <div class="mt-24 flex flex-wrap gap-8">
                    @if ($step === 'ask')
                        <form method="post" action="{{ $action }}">
                            <button type="submit" class="sc-focus relative inline-flex min-h-52 items-center justify-center gap-8 rounded-sm bg-inverse px-20 py-8 text-center text-body-strong text-ink-inverse" data-testid="WEB-UNSUB.confirm">{{ __('public.unsubscribe.confirm') }}</button>
                        </form>
                        <x-public.button :href="url('/app/settings/notifications')" variant="secondary" size="l" data-testid="WEB-UNSUB.settings">{{ __('public.unsubscribe.settings') }}</x-public.button>
                    @else
                        <x-public.button :href="url('/app/settings/notifications')" variant="primary" size="l" data-testid="WEB-UNSUB.settings">{{ __('public.unsubscribe.settings') }}</x-public.button>
                        <x-public.button :href="\App\Support\PublicUrl::to('/')" variant="tertiary" size="l" data-testid="WEB-UNSUB.home">{{ __('public.unsubscribe.home') }}</x-public.button>
                    @endif
                </div>
            </div>
        </div>
    </main>
</x-public.layout>
