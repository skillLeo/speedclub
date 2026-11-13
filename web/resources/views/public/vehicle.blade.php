{{--
    WEB-01 (FS-10, FS-3). $vehicle holds exactly PublicVehicleResource, $seo and $links come from App\Services\PublicPages\PublicPageData. All content is in the HTML
    without JavaScript, stacked and anchored. One markup for phone and desktop, which only differ in the grid of .sc-veh. $vehicle['owner'] is null when the owner switched show_owner_on_qr off.
--}}
@php
    $photos = $vehicle['photos'];
    $count = count($photos);
    $owner = $vehicle['owner'];
    $sections = ['overview' => 'section_overview', 'specs' => 'section_specs', 'mods' => 'section_mods', 'history' => 'section_history'];
    // DQ-1078: the Übersicht photo preview is one 3-up row — the photos after the hero, or from the first with fewer than four.
    $thumbs = $count >= 4 ? array_slice($photos, 1, 3) : array_slice($photos, 0, 3);
    $months = collect($vehicle['updates'])->groupBy('month_label');
    // As VEH-01's ModsSection: groups with rows only, and the disclaimer of 08_LEGAL §7 closes every non-empty list (ADR-153).
    $modGroups = array_values(array_filter($vehicle['mods']['groups'], fn (array $group): bool => $group['items'] !== []));
    $heroSizes = '(min-width: 1560px) 1320px, 100vw';
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
    display="marque"
>
    <x-public.top-bar :sign-in="$links['sign_in']" />

    <div class="flex-1">
        <main id="main" class="sc-veh" data-testid="WEB-01.root">
            {{-- DQ-1047/1048: the hero is the page's opener at every width — 4:5 edge to edge on a phone, 16:9 across the content (at most
                 1320) from 768 — fading into its dark stage (scrim.photo), the identity on it. Native scrolling and snap points, so it swipes
                 without JavaScript; app.ts only keeps the counter right. --}}
            <div class="sc-veh-stage{{ $count > 0 ? '' : ' is-empty' }}" data-testid="WEB-01.stage">
                <div class="sc-hero" data-testid="VEH-01.hero" data-qa-exempt="photo">
                    @if ($count > 0)
                        <div class="sc-pager" data-pager @if ($count > 1) tabindex="0" role="region" aria-roledescription="carousel" aria-label="{{ __('public.vehicle.gallery_label', ['title' => $vehicle['full_title']]) }}" @endif>
                            @foreach ($photos as $index => $photo)
                                <div class="sc-slide" id="photo-{{ $index + 1 }}">
                                    <x-public.photo :photo="$photo" :sizes="$heroSizes" :priority="$index === 0" :alt="$photo['alt'] ?: $vehicle['full_title']" class="h-full w-full object-cover" />
                                </div>
                            @endforeach
                            @if (($links['save'] ?? null) !== null)
                                {{-- [SIG] Speichern where VEH-01's photo header has it: before Teilen and Mehr, so 88 from the trailing edge of the bar.
                                     Inside the pager, so it belongs to the photos it sits on rather than lying across a focusable region; the pager
                                     is not positioned, so the hero stays its containing block and it neither scrolls with the slides nor gets clipped. --}}
                                <a href="{{ $links['save'] }}" class="sc-focus sc-hero-save" aria-label="{{ __('public.vehicle.save') }}" data-testid="VEH-01.save"><span class="sc-hero-chip bg-on-photo-chip text-on-photo"><x-public.icon name="bookmark-simple" :size="24" /></span></a>
                            @endif
                        </div>
                        <span class="sc-hero-scrim" aria-hidden="true"></span>
                        @if ($count > 1)
                            <span class="sc-counter rounded-xs bg-on-photo-chip px-8 py-4 text-caption tabular-nums text-on-photo" data-testid="VEH-01.photoCount" data-pager-count data-total="{{ $count }}">1/{{ $count }}</span>
                        @endif
                    @else
                        <div class="sc-hero-empty" data-testid="VEH-01.heroEmpty">
                            <x-public.icon name="images" :size="48" class="text-ink-3" />
                            <p class="mt-12 text-headline text-ink">{{ __('public.vehicle.no_photo') }}</p>
                            <p class="mt-4 text-callout text-ink-2">{{ $owner ? \App\Support\KeepTogether::sentence('public.vehicle.no_photo_owner', [], ['username' => $owner['username']]) : __('public.vehicle.no_photo_body') }}</p>
                        </div>
                    @endif
                </div>
                @if ($count > 0)
                    <x-public.vehicle-identity :vehicle="$vehicle" :owner="$owner" :on-photo="true" class="sc-hero-identity" />
                @endif
                <span class="sc-live text-caption" role="status" data-share-status></span>
            </div>

            {{-- Under the hero: the spec strip and the actions; from 1280 the sticky 4-column card beside the 8 columns of sections (DQ-1048). --}}
            <aside class="sc-veh-summary" aria-label="{{ __('public.vehicle.summary_label') }}">
                @if ($count === 0)
                    <x-public.vehicle-identity :vehicle="$vehicle" :owner="$owner" :on-photo="false" class="mb-16" />
                @endif
                @if ($vehicle['is_sample'] ?? false)
                    <p class="mb-16 text-caption text-ink-3" data-testid="WEB-01.sampleNote">{{ __('public.sample.vehicle_note') }}</p>
                @endif

                <x-public.spec-strip :items="$vehicle['spec_strip']" :groups="$vehicle['spec_groups'] ?? []" />

                @if ($owner)
                    {{-- M4.9 (09 §7.6 (4), DQ-919/972): Folgen (the one filled control) and Nachricht, then Speichern and Teilen. The test IDs
                         stay those of M1.6 (PublicPagesRenderTest, f-web02-actions). A guest's follow and message lead to the sign-in, which
                         brings them back through next=. --}}
                    <div class="sc-veh-actions mt-16 flex flex-wrap items-center gap-8" data-testid="WEB-01.actions">
                        <x-public.button :href="$links['sign_in']" variant="primary" data-testid="VEH-01.ownerRow.follow">{{ __('public.vehicle.follow') }}</x-public.button>
                        <x-public.button :href="$links['sign_in']" variant="secondary" data-testid="VEH-01.ownerRow.message">{{ __('public.vehicle.message') }}</x-public.button>
                        <span class="flex shrink-0">
                            @if (($links['save'] ?? null) !== null)
                                <a href="{{ $links['save'] }}" class="sc-focus sc-share sc-save-row" aria-label="{{ __('public.vehicle.save') }}" data-testid="VEH-01.saveRow"><x-public.icon name="bookmark-simple" :size="24" /></a>
                            @endif
                            <button type="button" class="sc-focus sc-share" data-share data-share-title="{{ $vehicle['full_title'] }}" data-share-url="{{ $seo['canonical'] }}" data-share-done="{{ __('public.vehicle.share_copied') }}" aria-label="{{ __('public.vehicle.share') }}" data-testid="VEH-01.share"><x-public.icon name="share-network" :size="24" /></button>
                        </span>
                    </div>
                @else
                    <div class="mt-16 flex">
                        @if (($links['save'] ?? null) !== null)
                            <a href="{{ $links['save'] }}" class="sc-focus sc-share sc-save-row" aria-label="{{ __('public.vehicle.save') }}" data-testid="VEH-01.saveRow"><x-public.icon name="bookmark-simple" :size="24" /></a>
                        @endif
                        <button type="button" class="sc-focus sc-share" data-share data-share-title="{{ $vehicle['full_title'] }}" data-share-url="{{ $seo['canonical'] }}" data-share-done="{{ __('public.vehicle.share_copied') }}" aria-label="{{ __('public.vehicle.share') }}" data-testid="VEH-01.share"><x-public.icon name="share-network" :size="24" /></button>
                    </div>
                @endif

                <div class="sc-veh-cta" data-testid="WEB-01.desktopCta">
                    <x-public.open-in-app :links="$links" testid="WEB-01.openInAppDesktop" :variant="$owner ? 'secondary' : 'brand'" class="sc-grow" />
                    <x-public.button :href="$links['register']" variant="secondary" size="l" class="sc-grow">{{ __('public.vehicle.register') }}</x-public.button>
                </div>
            </aside>

            <div class="sc-veh-content">
                {{-- FS-10: the content tabs of FS-3 as an anchored nav. Plain links, so the sections stay crawlable; app.ts marks the current one. --}}
                <nav class="sc-tabs sc-chrome" aria-label="{{ __('public.vehicle.nav_label') }}" data-testid="WEB-01.sectionNav" data-spy>
                    <div class="sc-tabs-row" tabindex="-1">
                        @foreach ($sections as $id => $label)
                            <a href="#{{ $id }}" class="sc-focus sc-tab text-callout" data-spy-link="{{ $id }}" @if ($loop->first) aria-current="true" @endif data-testid="WEB-01.nav.{{ $id }}">{{ __('public.vehicle.'.$label) }}</a>
                        @endforeach
                    </div>
                </nav>

                <section id="overview" class="sc-section" aria-labelledby="overview-title" data-testid="WEB-01.overview">
                    <h2 id="overview-title" class="t-title-2 text-ink">{{ __('public.vehicle.section_overview') }}</h2>

                    @if ($vehicle['description'])
                        <div class="mt-12">
                            <p class="sc-clamp whitespace-pre-line text-body text-ink" data-clamp data-testid="VEH-01.description">{{ \App\Support\SafeMarkdown::joinShortCompounds($vehicle['description']) }}</p>
                            <button type="button" class="sc-focus sc-more text-callout text-ink-2 hover:text-ink" data-clamp-toggle hidden aria-expanded="false" data-testid="VEH-01.more">{{ __('public.vehicle.more') }}</button>
                        </div>
                    @endif

                    @if ($vehicle['highlights'] !== [])
                        <x-public.section-header :title="__('public.vehicle.highlights')" href="#mods" :action="__('public.vehicle.all_mods', ['count' => $vehicle['mods']['count']])" class="mt-24" />
                        <ul class="sc-group mt-8" data-testid="VEH-01.highlights">
                            @foreach ($vehicle['highlights'] as $mod)
                                <x-public.mod-row :mod="$mod" />
                            @endforeach
                        </ul>
                    @endif

                    @if ($thumbs !== [])
                        <div class="sc-veh-photos mt-24">
                            <x-public.section-header :title="__('public.vehicle.photos')" :href="$links['web_app'].'/gallery'" :action="__('public.vehicle.all_photos', ['count' => $vehicle['photo_count']])" />
                            <div class="sc-veh-preview mt-8" data-testid="WEB-01.photoPreview">
                                @foreach ($thumbs as $photo)
                                    <span class="sc-preview-tile" data-qa-exempt="photo"><x-public.photo :photo="$photo" sizes="(min-width: 768px) 256px, 34vw" :alt="$photo['alt'] ?: $vehicle['full_title']" class="h-full w-full object-cover" /></span>
                                @endforeach
                            </div>
                        </div>
                    @endif

                    @if (! $vehicle['description'] && $vehicle['highlights'] === [] && $thumbs === [])
                        <p class="mt-12 text-body text-ink-2" data-testid="WEB-01.overviewEmpty">{{ __('public.vehicle.overview_empty') }}</p>
                    @endif
                </section>

                <section id="specs" class="sc-section" aria-labelledby="specs-title" data-testid="WEB-01.specs">
                    <h2 id="specs-title" class="t-title-2 text-ink">{{ __('public.vehicle.section_specs') }}</h2>
                    @foreach ($vehicle['spec_groups'] as $group)
                        <x-public.section-header :title="$group['label']" class="{{ $loop->first ? 'mt-16' : 'mt-24' }}" />
                        <dl class="sc-group sc-spec-box text-body mt-8">
                            @foreach ($group['rows'] as $row)
                                <x-public.spec-row :row="$row" />
                            @endforeach
                        </dl>
                    @endforeach
                </section>

                <section id="mods" class="sc-section" aria-labelledby="mods-title" data-testid="WEB-01.mods">
                    <h2 id="mods-title" class="flex items-center gap-8 t-title-2 text-ink">
                        {{ __('public.vehicle.section_mods') }}
                        @if ($vehicle['mods']['count'] > 0)
                            <span class="text-callout tabular-nums text-ink-3">{{ $vehicle['mods']['count'] }}</span>
                        @endif
                    </h2>
                    @forelse ($modGroups as $group)
                        <x-public.section-header :title="$group['category']['name']" :icon="$group['category']['icon'] ?? 'wrench'" :count="$group['count']" class="{{ $loop->first ? 'mt-16' : 'mt-24' }}" />
                        <ul class="sc-group mt-8">
                            @foreach ($group['items'] as $mod)
                                <x-public.mod-row :mod="$mod" />
                            @endforeach
                        </ul>
                    @empty
                        <p class="mt-12 text-body text-ink-2" data-testid="WEB-01.modsEmpty">{{ __('public.vehicle.mods_empty') }}</p>
                    @endforelse
                    @if ($modGroups !== [])
                        <p class="mt-16 text-caption text-ink-3" data-testid="WEB-01.legalDisclaimer">{{ __('garage.legal_disclaimer') }}</p>
                    @endif
                </section>

                <section id="history" class="sc-section" aria-labelledby="history-title" data-testid="WEB-01.history">
                    <h2 id="history-title" class="t-title-2 text-ink">{{ __('public.vehicle.section_history') }}</h2>
                    @forelse ($months as $month => $updates)
                        <div class="sc-month">
                            <h3 class="text-callout text-ink-2">{{ $month }}</h3>
                            <ol class="sc-month-list">
                                @foreach ($updates as $update)
                                    <li class="sc-update" data-testid="WEB-01.update">
                                        @forelse ($update['changes'] as $change)
                                            <p class="text-body-strong text-ink">{{ $change['label'] ?: $update['type_label'] }}</p>
                                            @if ($change['after'])
                                                <p class="text-callout tabular-nums text-ink-2">
                                                    @if ($change['before'])
                                                        {{-- DQ-234: no break before the arrow (the DQ-231 rule), the ordinary space after it is where the line may wrap. --}}
                                                        <span>{{ \App\Support\KeepTogether::figures($change['before']) }}</span>&nbsp;<span class="text-ink-3">→</span>
                                                    @endif
                                                    <span>{{ \App\Support\KeepTogether::figures($change['after']) }}</span>
                                                </p>
                                            @elseif ($change['text'])
                                                <p class="text-callout tabular-nums text-ink-2">{{ \App\Support\KeepTogether::figures($change['text']) }}</p>
                                            @endif
                                        @empty
                                            <p class="text-body-strong text-ink">{{ $update['type_label'] }}</p>
                                        @endforelse
                                        @if ($update['note'])
                                            <p class="whitespace-pre-line text-callout text-ink-2">{{ $update['note'] }}</p>
                                        @endif
                                    </li>
                                @endforeach
                            </ol>
                        </div>
                    @empty
                        <p class="mt-12 text-body text-ink-2" data-testid="WEB-01.historyEmpty">{{ __('public.vehicle.history_empty') }}</p>
                    @endforelse
                    @if ($vehicle['updates_count'] > count($vehicle['updates']))
                        <p class="mt-16 text-callout text-ink-2">{{ __('public.vehicle.history_more', ['count' => $vehicle['updates_count'] - count($vehicle['updates'])]) }}</p>
                    @endif
                </section>

                {{-- DQ-1057: no card and no second filled control (Folgen is the one): a guest's line under the sections and a text link to the
                     sign-in, which brings them back through next=. Lane B: `public.vehicle.closing_guest` ("Melde dich an, um :name zu
                     schreiben.") would match the app's copy word for word. --}}
                @if ($owner)
                    <section class="sc-closing" data-testid="VEH-01.closingOwner">
                        {{-- DQ-926/927: a person's name keeps its in-word hyphens, a handle is shown as it is (KeepTogether). --}}
                        <p class="text-callout text-ink-2">{{ $owner['display_name']
                            ? \App\Support\KeepTogether::sentence('public.vehicle.closing_title', ['name' => \App\Support\KeepTogether::inlineName($owner['display_name'])])
                            : \App\Support\KeepTogether::sentence('public.vehicle.closing_title', [], ['name' => '@'.$owner['username']]) }} {{ __('public.vehicle.closing_body') }}</p>
                        <x-public.button :href="$links['sign_in']" variant="tertiary" size="s" class="sc-closing-link" data-testid="VEH-01.closingMessage">{{ __('public.vehicle.message_send') }}</x-public.button>
                    </section>
                @endif
            </div>
        </main>

        <x-public.sticky-cta :links="$links" :quiet="$owner !== null" />
    </div>
</x-public.layout>
