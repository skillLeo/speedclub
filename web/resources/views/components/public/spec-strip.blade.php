@props(['items', 'groups' => [], 'testid' => 'VEH-01.specStrip'])
{{-- 09 §5 SpecStrip 2.0, the anatomy of the app's SpecStrip.tsx (the Blade/app parity test compares texts and pixels): per cell
     the label.caps data label (text.secondary), the hero numeral (hero.numeral on the page, hero.numeral.s in the desktop card, ADR-431 b; Archivo Condensed, tnum) with its label.unit
     unit on the baseline, and the provenance caption (text.tertiary); start-aligned. Power and torque take the spec's name as
     data label and the source of the same value in the spec tables as provenance (App\Support\SpecStripLayout::entries, as the
     app's specStripItems). A list, so a screen reader says "Leistung 500 PS Gemessen". DQ-801 / ADR-422: the columns follow the
     fit, by the app's rule (App\Support\SpecStripLayout, mirroring mobile/src/ui/specStripLayout.ts): one row when every line of
     every cell fits on one line with 12 on both sides, else the 2 × 2 grid, else one column; at the QA font scale 2 at most two.
     The rule becomes container queries for these values, pushed once per set of breakpoints into the nonced style block of the
     layout (stack sc-layout-css). --}}
@php
    $entries = \App\Support\SpecStripLayout::entries($items, $groups, [
        'power' => (string) __('garage.spec.power'),
        'torque' => (string) __('garage.spec.torque'),
    ]);
    $layout = \App\Support\SpecStripLayout::items($entries);
    $layoutClass = \App\Support\SpecStripLayout::className($layout);
@endphp
@pushOnce('sc-layout-css', $layoutClass)
{{ \App\Support\SpecStripLayout::style($layout, $layoutClass) }}
@endPushOnce
<div {{ $attributes->class(['sc-strip-box text-body', $layoutClass]) }}>
    <ul class="sc-strip" data-testid="{{ $testid }}">
        @foreach ($entries as $entry)
            <li class="sc-strip-cell" data-spec="{{ $entry['key'] }}">
                <span class="t-label-caps text-ink-2">{{ $entry['label'] }}</span>
                <span class="sc-strip-value">
                    <span class="sc-strip-numeral text-ink">{{ $entry['value'] ?? '–' }}</span>
                    @if ($entry['unit'] !== null && $entry['unit'] !== '')
                        <span class="t-label-unit text-ink-2">{{ $entry['unit'] }}</span>
                    @endif
                </span>
                @if ($entry['provenance'] !== null)
                    <span class="t-caption text-ink-3">{{ $entry['provenance'] }}</span>
                @endif
            </li>
        @endforeach
    </ul>
</div>
