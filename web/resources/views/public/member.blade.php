{{--
    WEB-02 (09 §7.7 PROF-02 as a public page, M4.16). $member holds MemberProfileResource, $vehicles a list of VehicleCardResource (public
    vehicles only), $cover, $seo and $links PublicPageData. The cover 16:9 (ADR-451: full-bleed on phones, inside the content column from 1280):
    the member's own, else a build photo no garage card shows, else the brand stage `stage-empty` (DQ-1234, as PROF-02 in the app),
    the avatar 88 overlapping it by half with a canvas ring, the name in title.1 (people speak Inter), @handle and "Stuttgart · Mitglied
    seit März 2023" as captions, the bio, one quiet meta line with real numbers (no stat boxes; none on a sample), "Folgen" as the one
    filled CTA and "Nachricht" secondary, then the garage as VehicleCards 2.0 (09 §5). A guest's follow and message lead to the sign-in.
--}}
@php
    $name = $member['display_name'] ?: '@'.$member['username'];
    $coverPhoto = $cover['photo'];
    $since = $member['member_since'] ? \Illuminate\Support\Carbon::parse($member['member_since'])->timezone(config('speedclub.display_timezone'))->locale(app()->getLocale())->isoFormat('MMMM YYYY') : null;
    $meta = array_filter([$member['city'], $since ? __('public.member.since', ['date' => $since]) : null]);
    $stats = $member['stats'];
    // 09 §8.19: a sample account shows no numbers (its counts are null).
    $sample = ($member['is_sample'] ?? false) === true;
    $vehicleCount = count($vehicles);
    $samplePhoto = $vehicles === [] ? \App\Services\PublicPages\PublicPhoto::brand('landing-station') : null;
    // The rendered width of a garage card's photo (public.css .sc-prof-garage): one column inside the gutters (20, 24 from 430) on a
    // phone, two of 348 in the 768 column from 768, two of 384 in the 8 columns from 1280. Not 100vw: that is 40–48 px wider and
    // let a 3× phone fetch the 1536 file.
    $cardSizes = '(min-width: 1280px) 384px, (min-width: 768px) 348px, (min-width: 430px) calc(100vw - 48px), calc(100vw - 40px)';
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
        <main id="main" class="sc-prof is-covered" data-testid="WEB-02.root">
            <div class="sc-prof-cover" data-testid="WEB-02.cover" data-cover-source="{{ $cover['source'] }}" data-qa-exempt="photo">
                <x-public.photo :photo="$coverPhoto" sizes="(min-width: 1280px) 816px, 100vw" alt="" :priority="true" class="h-full w-full object-cover" />
            </div>

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
                    {{-- Skill §10 (DQ, M4.16 r2): never an icon with a sentence. A garage card as it will look, on a photo of the brand layer
                         and badged "Beispiel" (09 §8.19), no numbers on it; then the line and one secondary action ("Folgen" stays the
                         page's one filled button). --}}
                    <div class="sc-prof-garage sc-garage-empty mt-12" data-testid="WEB-02.garageEmpty">
                        <figure class="sc-title-box" aria-label="{{ __('public.member.garage_sample_label') }}" data-testid="WEB-02.garageSample">
                            <span class="relative block aspect-[4/5] w-full overflow-hidden rounded-xl bg-surface" data-qa-exempt="photo">
                                <x-public.photo :photo="$samplePhoto" :sizes="$cardSizes" alt="" class="absolute inset-0 h-full w-full object-cover" />
                                <span class="absolute top-12 left-12 flex flex-wrap gap-4">
                                    <x-public.sample-badges :sample="true" :on-photo="true" testid="WEB-02.garageSample.badges" />
                                </span>
                            </span>
                            <x-public.display-title as="span" :text="__('public.member.garage_sample_title')" placement="card" :base="true" class="mt-12 block text-ink" aria-hidden="true" />
                            <figcaption class="mt-4 text-caption text-ink-2" aria-hidden="true">{{ __('public.member.garage_sample_caption') }}</figcaption>
                        </figure>
                        <div class="sc-garage-empty-text">
                            <p class="text-headline text-ink">{{ __('public.member.garage_empty') }}</p>
                            <p class="mt-4 text-body text-ink-2">{{ \App\Support\KeepTogether::sentence('public.member.garage_empty_body', [], ['username' => $member['username']]) }}</p>
                            <x-public.button :href="$links['register']" variant="secondary" class="mt-16" data-testid="WEB-02.garageEmptyAction">{{ __('public.member.garage_empty_action') }}</x-public.button>
                        </div>
                    </div>
                @else
                    <ul class="sc-prof-garage mt-12" data-testid="WEB-02.garage">
                        @foreach ($vehicles as $card)
                            {{-- Every card is deferred, the first one too (M4.16 LCP, photo.blade.php): every profile opens on a cover (ADR-469,
                                 DQ-1234), the page's one eager, high-priority photo and its LCP, so no card photo shares the bandwidth before it.
                                 An eager first card cost /u/jann.ptrs about 890 ms of Lighthouse LCP (its 176 KB file beside the 12 KB cover). --}}
                            <li><x-public.vehicle-card :card="$card" variant="garage" :sizes="$cardSizes" /></li>
                        @endforeach
                    </ul>
                @endif
            </section>
        </main>

        <x-public.sticky-cta :links="$links" :quiet="true" />
    </div>
</x-public.layout>
