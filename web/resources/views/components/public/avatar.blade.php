@props(['name', 'media' => null, 'size' => 40])
{{-- §8 avatar: a real photo or initials on bg.raised, one inner border. Sizes 32 (the owner chip on WEB-01's hero, DQ-1047), 40 and 96 here. --}}
@php
    $boxes = [32 => 'h-32 w-32', 40 => 'h-40 w-40', 96 => 'h-96 w-96'];
    // The app's rule (initialsOf in mobile/src/ui/Avatar.tsx): the first letter of the first two words, so both sides match.
    $words = preg_split('/[\s._-]+/u', ltrim($name, '@'), -1, PREG_SPLIT_NO_EMPTY) ?: [];
    $initial = mb_strtoupper(implode('', array_map(fn (string $word): string => mb_substr($word, 0, 1), array_slice($words, 0, 2))));
@endphp
<span {{ $attributes->class(['sc-avatar relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-raised', $boxes[$size]]) }} data-qa-exempt="photo">
    @if ($media && ($media['variants'] ?? []) !== [])
        <x-public.photo :photo="$media" :sizes="$size.'px'" alt="" class="h-full w-full object-cover" />
    @else
        <span aria-hidden="true" class="{{ $size >= 96 ? 't-title-2' : ($size <= 32 ? 'text-callout' : 'text-body-strong') }} text-ink-2">{{ $initial }}</span>
    @endif
</span>
