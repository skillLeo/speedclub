{{-- WEB-02 (FS-8 structure as a public page). $member holds MemberProfileResource, $vehicles a list of VehicleCardResource (public vehicles only), $seo and $links PublicPageData. --}}
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
    :auto-icons="$vehicles === []"
>
    <x-public.top-bar :sign-in="$links['sign_in']" />

    <div class="flex-1">
        <main id="main" data-testid="WEB-02.root">
            @if ($cover)
                <div class="sc-cover" data-testid="WEB-02.cover" data-qa-exempt="photo">
                    <x-public.photo :photo="$cover" sizes="100vw" alt="" :priority="true" class="h-full w-full object-cover" />
                </div>
            @endif

            <div class="sc-member {{ $cover ? 'sc-member-covered' : '' }}">
                <div class="sc-member-side" data-testid="WEB-02.header">
                    <x-public.avatar :name="$name" :media="$member['avatar']" :size="96" class="sc-member-avatar" />
                    <h1 class="mt-12 t-title-2 text-ink" data-testid="WEB-02.name">{{ $member['display_name'] ? \App\Support\KeepTogether::words($member['display_name']) : \App\Support\KeepTogether::identifier($name) }}</h1>
                    <p class="text-callout text-ink-2" data-testid="WEB-02.handle">{{ \App\Support\KeepTogether::identifier('@'.$member['username']) }}</p>
                    @if ($meta !== [])
                        <p class="mt-4 text-caption text-ink-3" data-testid="WEB-02.meta">{{ implode(' · ', $meta) }}</p>
                    @endif
                    @if ($sample || ($member['is_editorial'] ?? false))
                        <x-public.sample-badges :sample="$sample" :editorial="($member['is_editorial'] ?? false) === true" class="mt-8" testid="WEB-02.sampleBadges" />
                        <p class="mt-4 text-caption text-ink-3" data-testid="WEB-02.sampleNote">{{ __('public.sample.member_note') }}</p>
                    @endif

                    {{-- FS-8: inline, not boxes. Real numbers from the same resource as the app, zero included. DQ-224: a stat wraps as a whole, and its dot stays with it, as in ProfileHeader.tsx. --}}
                    @unless ($sample)
                    <p class="mt-12" data-testid="WEB-02.stats">
                        <span class="sc-keep"><span class="text-body-strong tabular-nums text-ink">{{ $vehicleCount }}</span>&nbsp;<span class="text-callout text-ink-2">{{ trans_choice('public.member.vehicles', $vehicleCount) }}&nbsp;·</span></span>
                        <span class="sc-keep"><span class="text-body-strong tabular-nums text-ink">{{ $stats['followers'] }}</span>&nbsp;<span class="text-callout text-ink-2">{{ trans_choice('public.member.followers', $stats['followers']) }}&nbsp;·</span></span>
                        <span class="sc-keep"><span class="text-body-strong tabular-nums text-ink">{{ $stats['following'] }}</span>&nbsp;<span class="text-callout text-ink-2">{{ __('public.member.following') }}</span></span>
                    </p>
                    @endunless

                    @if ($member['bio'])
                        <p class="mt-12 whitespace-pre-line text-body text-ink" data-testid="WEB-02.bio">{{ $member['bio'] }}</p>
                    @endif

                    <div class="mt-16 flex flex-wrap gap-8" data-testid="WEB-02.actions">
                        <x-public.button :href="$links['sign_in']" variant="primary" data-testid="WEB-02.follow">{{ __('public.vehicle.follow') }}</x-public.button>
                        <x-public.button :href="$links['sign_in']" variant="secondary" data-testid="WEB-02.message">{{ __('public.vehicle.message') }}</x-public.button>
                    </div>
                </div>

                <section class="sc-member-main" aria-labelledby="garage-title" data-testid="WEB-02.garageSection">
                    <h2 id="garage-title" class="text-headline text-ink">{{ __('public.member.garage') }}</h2>
                    @if ($vehicles === [])
                        <div class="sc-empty mt-12" data-testid="WEB-02.garageEmpty">
                            <x-public.icon name="wheel" :size="48" class="text-ink-3" />
                            <p class="mt-12 text-headline text-ink">{{ __('public.member.garage_empty') }}</p>
                            <p class="mt-4 text-body text-ink-2">{{ \App\Support\KeepTogether::sentence('public.member.garage_empty_body', [], ['username' => $member['username']]) }}</p>
                        </div>
                    @else
                        <ul class="sc-garage {{ $vehicleCount === 1 ? 'sc-garage-single' : '' }} mt-12" data-testid="WEB-02.garage">
                            @foreach ($vehicles as $card)
                                {{-- The first card is in the first viewport on a phone, larger than the cover band, so it is not lazy. --}}
                                <li class="sc-garage-item"><x-public.vehicle-card :card="$card" :eager="$loop->first" /></li>
                            @endforeach
                        </ul>
                    @endif
                </section>
            </div>
        </main>

        <x-public.sticky-cta :links="$links" />
    </div>
</x-public.layout>
