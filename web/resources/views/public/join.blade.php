{{--
    M5.9d WEB-17 /join/{code} (m5.9d contract §5): an invite link opened in a browser. The installed app takes the path itself (App Links /
    Universal Links). state: valid (who invites, the code, "Mit Einladung registrieren" → the member web's /app/join/{code}, "App laden")
    · invalid (404: unknown, used or no longer valid; sign up without a code). Sessionless, noindex; rate limits answer public.state.
--}}
@php
    $photo = \App\Services\PublicPages\PublicPhoto::brand('state-garage');
    $name = $inviter === null ? null : ($inviter['display_name'] ?: '@'.$inviter['username']);
    $title = $state === 'valid'
        ? ($name === null ? __('public.join.title_plain') : __('public.join.title', ['name' => $name]))
        : __('public.join.invalid_title');
@endphp
<x-public.layout :title="$title.' · Speedclub'" :description="__('public.join.description')" robots="noindex">
    <x-public.top-bar />
    <main id="main" class="sc-state flex-1" data-testid="WEB-17.root" data-state="{{ $state }}">
        <div class="sc-state-photo" data-qa-exempt="photo">
            <x-public.photo :photo="$photo" sizes="(min-width: 1280px) 50vw, 100vw" alt="" :priority="true" class="h-full w-full object-cover" />
        </div>
        <div class="sc-state-copy">
            <div class="sc-state-measure">
                <x-public.icon :name="$state === 'valid' ? 'meet' : 'prohibit'" :size="24" class="text-ink-2" />
                <h1 class="mt-12 t-title-1 text-ink" data-testid="WEB-17.title">{{ $title }}</h1>
                @if ($state === 'valid')
                    <p class="mt-8 text-body text-ink-2" data-testid="WEB-17.body">{{ __('public.join.body') }}</p>
                    @if ($inviter !== null && $inviter['display_name'])
                        <p class="mt-8 text-callout text-ink-3" data-testid="WEB-17.username">{{ '@'.$inviter['username'] }}</p>
                    @endif
                    <p class="mt-16 text-callout text-ink-2" data-testid="WEB-17.code">
                        {{ __('public.join.code_label') }} <span class="tabular-nums text-ink">{{ $code }}</span>
                    </p>
                    <div class="mt-24 flex flex-wrap gap-8">
                        <x-public.button :href="url('/app/join/'.$code)" variant="primary" size="l" data-testid="WEB-17.signUp">{{ __('public.join.sign_up') }}</x-public.button>
                        <x-public.button :href="url('/app-laden')" variant="secondary" size="l" data-testid="WEB-17.getApp">{{ __('public.join.get_app') }}</x-public.button>
                    </div>
                    <p class="mt-16 text-callout text-ink-3" data-testid="WEB-17.note">{{ __('public.join.note') }}</p>
                @else
                    <p class="mt-8 text-body text-ink-2" data-testid="WEB-17.body">{{ __('public.join.invalid_body') }}</p>
                    <div class="mt-24 flex flex-wrap gap-8">
                        <x-public.button :href="url('/app/sign-up')" variant="primary" size="l" data-testid="WEB-17.signUp">{{ __('public.join.sign_up_plain') }}</x-public.button>
                        <x-public.button :href="\App\Support\PublicUrl::to('/')" variant="secondary" size="l" data-testid="WEB-17.home">{{ __('public.state.home') }}</x-public.button>
                    </div>
                @endif
            </div>
        </div>
    </main>
</x-public.layout>
