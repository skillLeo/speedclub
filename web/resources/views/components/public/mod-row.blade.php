@props(['mod'])
{{-- §8 mod row: glyph 20, name, key values, status (centred on the row, as in the app). On a public page it has no detail to open. Legal status only when the owner stated one (08_LEGAL §7: the disclaimer sits under the list). --}}
@php
    $title = $mod['title'];
    $summary = (string) ($mod['summary_line'] ?? '');
    $values = str_starts_with($summary, $title.' · ') ? mb_substr($summary, mb_strlen($title) + 3) : ($summary === $title ? null : $summary);
    $legal = ($mod['legal_status'] ?? null) && $mod['legal_status'] !== 'unknown' ? ($mod['legal_status_label'] ?? null) : null;
@endphp
<li {{ $attributes->class('sc-mod-row') }} data-testid="WEB-01.modRow">
    <x-public.icon :name="$mod['category']['icon'] ?? 'wrench'" :size="20" class="sc-mod-glyph text-ink-2" />
    <div class="min-w-0 flex-1">
        <p class="text-body-strong text-ink">{{ $title }}</p>
        @if ($values)
            <p class="text-supporting tabular-nums text-ink-2">{{ \App\Support\KeepTogether::figures($values) }}</p>
        @endif
        @if ($legal)
            {{-- As VEH-01's ModRow (DQ-424): the legal pill never sits beside the install status; it goes under the values, on the text's edge. --}}
            <div class="mt-4 flex flex-wrap gap-x-8 gap-y-4">
                <x-public.status-pill :label="$legal" data-testid="WEB-01.legalStatus" />
            </div>
        @endif
    </div>
    <div class="flex shrink-0 self-center">
        <x-public.status-pill :label="$mod['status_label']" />
    </div>
</li>
