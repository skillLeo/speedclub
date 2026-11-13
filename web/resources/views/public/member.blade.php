{{--
    WEB-02 (09 §7.7 PROF-02 as a public page, M4.16). $member holds MemberProfileResource, $vehicles a list of VehicleCardResource (public
    vehicles only), $seo and $links PublicPageData. The cover 16:9 (ADR-451: full-bleed on phones, inside the content column from 1280),
    the avatar 88 overlapping it by half with a canvas ring, the name in title.1 (people speak Inter), @handle and "Stuttgart · Mitglied
    seit März 2023" as captions, the bio, one quiet meta line with real numbers (no stat boxes; none on a sample), "Folgen" as the one
    filled CTA and "Nachricht" secondary, then the garage as VehicleCards 2.0 (09 §5). A guest's follow and message lead to the sign-in.
--}}
@php
    $name = $member['display_name'] ?: '@'.$member['username'];
    $cover = ($member['cover']['variants'] ?? []) !== [] ? $member['cover'] : null;
    $since = $member['member_since'] ? \Illuminate\Support\Carbon::parse($member['member_since'])->timezone(config('speedclub.display_timezone'))->locale(app()->getLocale())->isoFormat('MMMM YYYY') : null;
    $meta = array_filter([$member['city'], $since ? __('public.member.since', ['date' => $since]) : null]);
    $stats = $member['stats'];
    // 09 §8.19: a sample account shows no numbers (its counts are null).
    $sample = ($member['is_sample'] ?? false) === true;
    $vehicleCount = count($vehicles);
@endphp
<x-public.layout
    :title="$seo['title']"
    :description="$seo['description']"
    :robots="$seo['robots']"
    :canonical="$seo['canonical']"
    :image="$seo['image']"
    :image-square="$seo['image_square']"
    :image-alt="$seo['image_alt']"
    :og-type="$seo['og_type']"
    :json-ld="$seo['json_ld']"
    :auto-icons="true"
>
    <x-public.top-bar :sign-in="$links['sign_in']" />

    <div class="flex-1">
        <main id="main" @class(['sc-prof', 'is-covered' => $cover !== null]) data-testid="WEB-02.root">
            @if ($cover)
                <div class="sc-prof-cover" data-testid="WEB-02.cover" data-qa-exempt="photo">
                    <x-public.photo :photo="$cover" sizes="(min-width: 1280px) 816px, 100vw" alt="" :priority="true" class="h-full w-full object-cover" />
                </div>
            @endif

            <div class="sc-prof-side" data-testid="WEB-02.header">
                <x-public.avatar :name="$name" :media="$member['avatar']" :size="88" class="sc-prof-avatar" />
                <h1 class="mt-12 t-title-1 text-ink" data-testid="WEB-02.name">{{ $member['display_name'] ? \App\Support\KeepTogether::words($member['display_name']) : \App\Support\KeepTogether::identifier($name) }}</h1>
                <p class="mt-4 text-caption text-ink-2" data-testid="WEB-02.handle">{{ \App\Support\KeepTogether::identifier('@'.$member['username']) }}</p>
                @if ($meta !== [])
                    <p class="text-caption text-ink-2" data-testid="WEB-02.meta">{{ implode(' · ', $meta) }}</p>
                @endif
                @if ($sample || ($member['is_editorial'] ?? false))
                    <x-public.sample-badges :sample="$sample" :editorial="($member['is_editorial'] ?? false) === true" class="mt-8" testid="WEB-02.sampleBadges" />
                    <p class="mt-4 text-caption text-ink-3" data-testid="WEB-02.sampleNote">{{ __('public.sample.member_note') }}</p>
                @endif

                @if ($member['bio'])
                    <p class="mt-12 whitespace-pre-line text-body text-ink" data-testid="WEB-02.bio">{{ $member['bio'] }}</p>
                @endif

                {{-- 09 §7.7: one quiet meta line, not boxes. Real numbers from the same resource as the app, zero included. DQ-224: a stat wraps
                     as a whole, and its dot stays with it, as in ProfileHeader.tsx. --}}
                @unless ($sample)
                    <p class="mt-12 text-callout text-ink-2" data-testid="WEB-02.stats">
                        <span class="sc-keep"><span class="tabular-nums text-ink">{{ $vehicleCount }}</span>&nbsp;{{ trans_choice('public.member.vehicles', $vehicleCount) }}&nbsp;·</span>
                        <span class="sc-keep"><span class="tabular-nums text-ink">{{ $stats['followers'] }}</span>&nbsp;{{ trans_choice('public.member.followers', $stats['followers']) }}&nbsp;·</span>
                        <span class="sc-keep"><span class="tabular-nums text-ink">{{ $stats['following'] }}</span>&nbsp;{{ __('public.member.following') }}</span>
                    </p>
                @endunless

                <div class="mt-16 flex flex-wrap items-center gap-8" data-testid="WEB-02.actions">
                    <x-public.button :href="$links['sign_in']" variant="primary" data-testid="WEB-02.follow">{{ __('public.vehicle.follow') }}</x-public.button>
                    <x-public.button :href="$links['sign_in']" variant="secondary" data-testid="WEB-02.message">{{ __('public.vehicle.message') }}</x-public.button>
                    <button type="button" class="sc-focus sc-share" data-share data-share-title="{{ $name }}" data-share-url="{{ $seo['canonical'] }}" data-share-done="{{ __('public.vehicle.share_copied') }}" aria-label="{{ __('public.vehicle.share') }}" data-testid="WEB-02.share"><x-public.icon name="share-network" :size="24" /></button>
                </div>
                <span class="sc-live text-caption" role="status" data-share-status></span>
            </div>

            <section class="sc-prof-main" aria-labelledby="garage-title" data-testid="WEB-02.garageSection">
                <x-public.section-header id="garage-title" level="h2" :title="__('public.member.garage')" :count="$vehicleCount > 0 ? $vehicleCount : null" icon="garage-bay" />
                @if ($vehicles === [])
                    <div class="sc-empty mt-12" data-testid="WEB-02.garageEmpty">
                        <x-public.icon name="wheel" :size="48" class="text-ink-3" />
                        <p class="mt-12 text-headline text-ink">{{ __('public.member.garage_empty') }}</p>
                        <p class="mt-4 text-body text-ink-2">{{ \App\Support\KeepTogether::sentence('public.member.garage_empty_body', [], ['username' => $member['username']]) }}</p>
                    </div>
                @else
                    <ul class="sc-prof-garage mt-12" data-testid="WEB-02.garage">
                        @foreach ($vehicles as $card)
                            {{-- The first card is in the first viewport on a phone without a cover, so it is not lazy. --}}
                            <li><x-public.vehicle-card :card="$card" variant="garage" sizes="(min-width: 1280px) 396px, (min-width: 768px) 50vw, 100vw" :eager="$loop->first && ! $cover" /></li>
                        @endforeach
                    </ul>
                @endif
            </section>
        </main>

        <x-public.sticky-cta :links="$links" :quiet="true" />
    </div>
</x-public.layout>
