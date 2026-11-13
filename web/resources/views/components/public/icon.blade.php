@props(['name' => 'wrench', 'size' => 20])
@php
    // The custom automotive glyphs (03_DESIGN_SYSTEM §6), everything else is Phosphor. Sizes 16/20/24, and 48 only in an empty state (§8).
    $auto = ['wheel', 'tyre', 'coilover', 'air-suspension', 'exhaust', 'turbo', 'intake', 'engine', 'ecu-chip', 'brake-disc', 'wing', 'seat', 'light', 'audio', 'gearbox', 'drivetrain', 'workshop', 'part-box', 'garage-bay', 'meet', 'cruise-route', 'track-day', 'qr-sticker'];
    $phosphor = ['arrow-right', 'arrow-square-out', 'bookmark-simple', 'calendar-blank', 'caret-right', 'clock', 'compass', 'device-mobile', 'images', 'list-bullets', 'lock-simple', 'magnifying-glass', 'map-pin', 'prohibit', 'qr-code', 'share-network', 'wrench'];
    $id = in_array($name, $auto, true) ? 'auto-'.$name : 'ph-'.(in_array($name, $phosphor, true) ? $name : 'wrench');
@endphp
<svg {{ $attributes->class('shrink-0') }} width="{{ $size }}" height="{{ $size }}" aria-hidden="true" focusable="false"><use href="#{{ $id }}"></use></svg>
