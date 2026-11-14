{{-- WEB-15 product row (09 §5 ProductRow, ADR-457): a 48 thumbnail at radius 8 from a real build that uses the part, name and category,
     and "In 14 Builds" (real builds) only where $count is set. DQ-1167: without such a photo the row has no tile at all, never a glyph in
     a square (SKILL §5); name and category start at the row's edge. --}}
@php
    $thumb = is_array($product['thumbnail'] ?? null) && ($product['thumbnail']['variants'] ?? []) !== [] ? $product['thumbnail'] : null;
@endphp
<li class="sc-row" data-testid="WEB-15.product">
    <span class="flex min-w-0 items-center gap-12">
        @if ($thumb)
            <span class="sc-row-thumb" data-qa-exempt="photo" data-testid="WEB-15.productThumb">
                <x-public.photo :photo="$thumb" sizes="48px" alt="" class="h-full w-full object-cover" />
            </span>
        @endif
        <span class="min-w-0">
            <span class="block text-headline text-ink">{{ $product['name'] }}</span>
            <span class="block text-caption text-ink-2">{{ $product['category']['name'] }}</span>
        </span>
    </span>
    @if ($count)
        <span class="text-caption tabular-nums text-ink-2 whitespace-nowrap" data-testid="WEB-15.productBuilds">{{ trans_choice('public.brand.in_builds', (int) $product['builds'], ['count' => \App\Support\Units::formatNumber((int) $product['builds'], app()->getLocale(), 0)]) }}</span>
    @endif
</li>
