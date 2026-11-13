{{--
    WEB-09 /e/{slug} (09 §9, EVT-02 ★ as a public page). $event holds EventResource as a guest reads it, $when the date in words, $map the
    openstreetmap.org links (opened only by a tap, ADR-449), $rules the checked community rules, $seo and $links from
    App\Services\PublicPages\EventPage. Readable without JavaScript. The place of an after_rsvp event is the city and "Ort nach Zusage",
    never more (09 §8.7). Counts are real; a sample shows none (09 §8.19). Zusagen happens in the app: the filled CTA opens it.
--}}
@php
    $cover = ($event['cover']['variants'] ?? []) !== [] ? $event['cover'] : null;
    $photo = $cover ?? \App\Services\PublicPages\PublicPhoto::brand('landing-hero');
    $location = $event['location'];
    $organiser = $event['organiser'];
    $organiserName = $organiser['display_name'] ?: '@'.$organiser['username'];
    $counts = $event['counts'];
    $cancelled = $when['cancelled'];
    $open = ! $cancelled && ! $when['past'];
    $address = $location['exact'] ? array_filter([$location['street'], trim(($location['postcode'] ?? '').' '.($location['city'] ?? ''))]) : [];
    $glyph = ['meet' => 'meet', 'cruise' => 'cruise-route', 'track_day' => 'track-day', 'show' => 'meet'][$event['type']] ?? 'meet';
@endphp
<x-public.layout
    :title="$seo['title']"
    :description="$seo['description']"
    :robots="$seo['robots']"
    :canonical="$seo['canonical']"
    :image="$seo['image']"
    :image-square="$seo['image_square']"
    :image-alt="$seo['image_alt']"
    og-type="website"
    :json-ld="$seo['json_ld']"
    :auto-icons="true"
>
    <x-public.top-bar :sign-in="$links['sign_in']" />

    <div class="flex-1">
        <main id="main" class="sc-evt" data-testid="WEB-09.root" data-state="{{ $cancelled ? 'cancelled' : ($when['past'] ? 'past' : 'open') }}">
            {{-- 09 §7.10: the cover 16:9 full-bleed; without one the brand layer's night photo, decorative. --}}
            <div class="sc-evt-stage" data-testid="WEB-09.cover" data-qa-exempt="photo">
                <x-public.photo :photo="$photo" sizes="(min-width: 1320px) 1320px, 100vw" :alt="$cover ? ($cover['alt'] ?? '') : ''" :priority="true" class="h-full w-full object-cover" />
                @if ($event['is_sample'] || $cancelled)
                    <span class="sc-evt-badges flex flex-wrap gap-4">
                        @if ($cancelled)
                            <span class="inline-flex min-h-20 items-center rounded-xs bg-on-photo-chip px-8 text-label-badge whitespace-nowrap hyphens-none text-on-photo" data-testid="WEB-09.cancelledBadge">{{ __('public.event.cancelled') }}</span>
                        @endif
                        <x-public.sample-badges :sample="$event['is_sample']" :on-photo="true" testid="WEB-09.sample" />
                    </span>
                @endif
            </div>

            <div class="sc-evt-main">
                <header data-testid="WEB-09.header">
                    <div class="flex items-start gap-16">
                        <time datetime="{{ $when['datetime'] }}" class="sc-evt-date" data-testid="WEB-09.date">
                            <span class="t-hero-numeral-s text-ink">{{ $when['day'] }}</span>
                            <span class="t-label-caps text-ink-2">{{ rtrim($when['month'], '.') }}</span>
                        </time>
                        <div class="min-w-0 pt-4">
                            <p class="flex items-center gap-8 text-callout text-ink-2"><x-public.icon :name="$glyph" :size="20" /><span>{{ $type }} · {{ $when['weekday'] }}</span></p>
                            <p class="mt-4 text-callout tabular-nums text-ink" data-testid="WEB-09.time">{{ $when['time'] }}</p>
                            @if ($when['ends'])
                                <p class="text-caption tabular-nums text-ink-2">{{ __('public.event.until', ['date' => $when['ends']]) }}</p>
                            @endif
                        </div>
                    </div>
                    <h1 class="mt-16 t-title-1 text-ink" data-testid="WEB-09.title">{{ \App\Support\KeepTogether::words($event['title']) }}</h1>
                    <a href="{{ \App\Support\PublicUrl::to('/u/'.$organiser['username']) }}" class="sc-focus sc-evt-organiser mt-12" data-testid="WEB-09.organiser">
                        <x-public.avatar :name="$organiserName" :media="$organiser['avatar']" :size="32" />
                        <span class="min-w-0 text-callout text-ink-2">{{ __('public.event.organised_by') }} <span class="text-ink">{{ \App\Support\KeepTogether::identifier('@'.$organiser['username']) }}</span></span>
                    </a>
                </header>

                @if ($cancelled)
                    <div class="sc-evt-notice mt-24" role="status" data-testid="WEB-09.cancelled">
                        <p class="flex items-center gap-8 text-headline text-ink"><x-public.icon name="prohibit" :size="20" class="text-ink-2" />{{ __('public.event.cancelled_title') }}</p>
                        @if ($event['cancellation_reason'])
                            <p class="mt-4 whitespace-pre-line text-body text-ink-2">{{ $event['cancellation_reason'] }}</p>
                        @endif
                    </div>
                @elseif ($when['past'])
                    <p class="sc-evt-notice mt-24 text-callout text-ink-2" role="status" data-testid="WEB-09.past">{{ __('public.event.past') }}</p>
                @endif

                @if ($event['is_sample'])
                    <p class="mt-16 text-caption text-ink-3" data-testid="WEB-09.sampleNote">{{ __('public.event.sample_note') }}</p>
                @endif

                <section class="sc-evt-section" aria-labelledby="place-title" data-testid="WEB-09.place">
                    <h2 id="place-title" class="text-callout-strong text-ink">{{ __('public.event.place') }}</h2>
                    <div class="sc-rows mt-8">
                        <div class="sc-row justify-start">
                            <x-public.icon :name="$location['exact'] ? 'map-pin' : 'lock-simple'" :size="20" class="text-ink-2" />
                            <div class="min-w-0 flex-1">
                                @if ($location['exact'])
                                    <p class="text-body-strong text-ink" data-testid="WEB-09.venue">{{ $location['venue_name'] ?? $location['city'] }}</p>
                                    @if ($address !== [])
                                        <address class="not-italic text-callout text-ink-2" data-testid="WEB-09.address">{{ implode(', ', $address) }}</address>
                                    @endif
                                @else
                                    <p class="text-body-strong text-ink" data-testid="WEB-09.city">{{ $location['city'] }}</p>
                                    <p class="text-callout text-ink-2" data-testid="WEB-09.afterRsvp">{{ __('public.event.place_after_rsvp') }}</p>
                                @endif
                            </div>
                        </div>
                    </div>
                    @if ($map['map'] || $map['route'])
                        <div class="mt-8 flex flex-wrap gap-8">
                            @if ($map['map'])
                                <x-public.button :href="$map['map']" variant="tertiary" size="s" target="_blank" rel="noopener noreferrer" data-testid="WEB-09.map">{{ $location['exact'] ? __('public.event.show_map') : __('public.event.show_area') }} <x-public.icon name="arrow-square-out" :size="16" /></x-public.button>
                            @endif
                            @if ($map['route'])
                                <x-public.button :href="$map['route']" variant="tertiary" size="s" target="_blank" rel="noopener noreferrer" data-testid="WEB-09.route">{{ __('public.event.route') }} <x-public.icon name="arrow-square-out" :size="16" /></x-public.button>
                            @endif
                        </div>
                        <p class="mt-4 text-caption text-ink-3">{{ __('public.event.map_note') }}</p>
                    @endif
                </section>

                @if ($event['description'])
                    <section class="sc-evt-section" aria-labelledby="about-title" data-testid="WEB-09.about">
                        <h2 id="about-title" class="text-callout-strong text-ink">{{ __('public.event.about') }}</h2>
                        <p class="mt-8 whitespace-pre-line text-body text-ink">{{ $event['description'] }}</p>
                    </section>
                @endif

                <section class="sc-evt-section" aria-labelledby="rules-title" data-testid="WEB-09.rules">
                    <h2 id="rules-title" class="text-callout-strong text-ink">{{ __('public.event.rules') }}</h2>
                    @if ($rules !== [])
                        <ul class="sc-rows mt-8">
                            @foreach ($rules as $rule)
                                <li class="sc-row justify-start text-callout text-ink">{{ $rule }}</li>
                            @endforeach
                        </ul>
                    @endif
                    @if ($event['organiser_rules'])
                        <p class="mt-12 text-caption text-ink-3">{{ __('public.event.organiser_rules', ['username' => $organiser['username']]) }}</p>
                        <p class="mt-4 whitespace-pre-line text-body text-ink">{{ $event['organiser_rules'] }}</p>
                    @endif
                    <p class="mt-8 text-caption"><a href="{{ \App\Support\PublicUrl::to('/community-richtlinien') }}" class="sc-focus inline-flex min-h-44 items-center text-ink-2 underline">{{ __('public.event.community_rules') }}</a></p>
                </section>

                <section class="sc-evt-section" aria-labelledby="people-title" data-testid="WEB-09.attendance">
                    <h2 id="people-title" class="text-callout-strong text-ink">{{ __('public.event.attendance') }}</h2>
                    @if ($counts === null)
                        <p class="mt-8 text-callout text-ink-2" data-testid="WEB-09.countsHidden">{{ __('public.event.counts_sample') }}</p>
                    @else
                        <p class="mt-8 text-body text-ink" data-testid="WEB-09.counts">
                            <span class="tabular-nums">{{ trans_choice('public.event.going', $counts['going'], ['count' => $counts['going']]) }}</span>
                            <span class="text-ink-2"> · </span>
                            <span class="tabular-nums">{{ trans_choice('public.event.interested', $counts['interested'], ['count' => $counts['interested']]) }}</span>
                        </p>
                        @if ($event['spots_left'] !== null && $open)
                            <p class="mt-4 text-callout tabular-nums text-ink-2" data-testid="WEB-09.spots">{{ $event['spots_left'] > 0 ? trans_choice('public.event.spots_left', $event['spots_left'], ['count' => $event['spots_left']]) : __('public.event.waitlist') }}</p>
                        @endif
                    @endif
                </section>

                <p class="mt-24 text-caption"><a href="{{ \App\Support\PublicUrl::to('/melden') }}" class="sc-focus inline-flex min-h-44 items-center text-ink-2 underline" data-testid="WEB-09.report">{{ __('public.event.report') }}</a></p>
            </div>

            {{-- From 1280 the 4-column card beside the sections, as WEB-01's (09 §7.6 web): when, where, the actions. --}}
            <aside class="sc-evt-side" aria-label="{{ __('public.event.summary_label') }}" data-testid="WEB-09.side">
                <p class="t-label-caps text-ink-2">{{ $type }}</p>
                <p class="mt-8 text-headline text-ink">{{ $when['date'] }}</p>
                <p class="text-callout tabular-nums text-ink-2">{{ $when['time'] }}</p>
                <p class="mt-8 text-callout text-ink-2">{{ $location['exact'] ? implode(', ', array_filter([$location['venue_name'], $location['city']])) : $location['city'] }}</p>
                <div class="sc-evt-cta" data-testid="WEB-09.desktopCta">
                    <x-public.open-in-app :links="$links" testid="WEB-09.openInAppDesktop" :label="$open ? __('public.event.rsvp_in_app') : null" class="sc-grow" />
                    @if ($open && $event['calendar_url'])
                        <x-public.button :href="$event['calendar_url']" variant="secondary" size="l" class="sc-grow" data-testid="WEB-09.calendarDesktop"><x-public.icon name="calendar-blank" :size="20" />{{ __('public.event.calendar') }}</x-public.button>
                    @endif
                </div>
                <p class="mt-12 text-caption text-ink-3">{{ __('public.event.join_hint') }} <a href="{{ $links['register'] }}" class="sc-focus inline-flex min-h-44 items-center text-ink underline" data-testid="WEB-09.register">{{ __('public.vehicle.register') }}</a></p>
            </aside>
        </main>

        <x-public.sticky-cta :links="$links" testid="WEB-09.stickyBar" :open-label="$open ? __('public.event.rsvp_in_app') : null">
            @if ($open && $event['calendar_url'])
                <x-public.button :href="$event['calendar_url']" variant="secondary" size="l" class="sc-grow" data-testid="WEB-09.calendar"><x-public.icon name="calendar-blank" :size="20" />{{ __('public.event.calendar') }}</x-public.button>
            @endif
        </x-public.sticky-cta>
    </div>
</x-public.layout>
