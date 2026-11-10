{{--
    QR-02 car-show placard [SIG sig.placard_pdf], A5 or A4 portrait (m2.7-contract §1): photo, title, Technik, top mods per category, the code
    with its short code and the logo beside it, never inside it (02_PRODUCT_SPEC §3.4). Black on white for print. The photo and the code arrive
    as data URIs; dompdf reads nothing else but the fonts and the brand folder (Placard::chroot, SEC-P1-11).
--}}
@php
    $a4 = $size === 'a4';
    $k = $a4 ? 1.414 : 1.0;
    $mm = fn (float $value): string => round($value * $k, 2).'mm';
    $pt = fn (float $value): string => round($value * $k, 2).'pt';
@endphp
<!DOCTYPE html>
<html lang="{{ app()->getLocale() }}">
<head>
    <meta charset="utf-8">
    <title>{{ __('signature.placard.title') }}</title>
    <style>
        @page { size: {{ $a4 ? '210mm 297mm' : '148mm 210mm' }}; margin: 0; }
        html, body { margin: 0; padding: 0; background: #ffffff; color: #000000; font-family: 'Inter', sans-serif; font-weight: 400; }
        .sheet { padding: {{ $mm(7) }} {{ $mm(9) }}; }
        .photo img { width: 100%; height: {{ $mm(44) }}; display: block; }
        .eyebrow { font-family: 'Barlow Semi Condensed', sans-serif; font-weight: 700; font-size: {{ $pt(9) }}; letter-spacing: {{ $pt(1) }}; margin: {{ $mm(4) }} 0 0; }
        .title { font-family: 'Barlow Semi Condensed', sans-serif; font-weight: 700; font-size: {{ $pt(22) }}; line-height: {{ $pt(24) }}; margin: {{ $mm(0.5) }} 0 0; }
        .subline { font-size: {{ $pt(8.5) }}; line-height: {{ $pt(11) }}; margin: {{ $mm(1) }} 0 0; }
        table { border-collapse: collapse; width: 100%; }
        td { padding: 0; vertical-align: top; }
        .columns { margin-top: {{ $mm(3) }}; }
        .column { width: 50%; }
        .column-left { padding-right: {{ $mm(3) }}; }
        .column-right { padding-left: {{ $mm(3) }}; }
        h2 { font-family: 'Barlow Semi Condensed', sans-serif; font-weight: 700; font-size: {{ $pt(10) }}; margin: 0 0 {{ $mm(1) }}; padding-bottom: {{ $mm(0.8) }}; border-bottom: 0.75pt solid #000000; }
        h3 { font-weight: 700; font-size: {{ $pt(7) }}; margin: {{ $mm(1.5) }} 0 {{ $mm(0.3) }}; }
        .row td { font-size: {{ $pt(7) }}; line-height: {{ $pt(9) }}; padding: {{ $mm(0.2) }} 0; border-bottom: 0.25pt solid #999999; }
        .row .value { text-align: right; font-weight: 700; padding-left: {{ $mm(2) }}; }
        .mod { font-size: {{ $pt(7) }}; line-height: {{ $pt(9) }}; margin: 0; }
        .more { font-size: {{ $pt(7) }}; line-height: {{ $pt(9) }}; margin: {{ $mm(0.5) }} 0 0; }
        .footer { margin-top: {{ $mm(3) }}; border-top: 0.75pt solid #000000; }
        .footer td { padding-top: {{ $mm(2.5) }}; }
        .code-cell { width: {{ $mm(26) }}; }
        .code-cell img { width: {{ $mm(26) }}; height: {{ $mm(26) }}; display: block; }
        .info-cell { padding-left: {{ $mm(4) }}; vertical-align: middle; }
        .logo { width: {{ $mm(24) }}; height: auto; }
        .scan { font-size: {{ $pt(8) }}; line-height: {{ $pt(10) }}; margin: {{ $mm(1.5) }} 0 0; }
        .short-code { font-weight: 700; font-size: {{ $pt(11) }}; line-height: {{ $pt(13) }}; letter-spacing: {{ $pt(1) }}; margin: {{ $mm(0.5) }} 0 0; }
        .small { font-size: {{ $pt(6.5) }}; line-height: {{ $pt(8) }}; margin: {{ $mm(0.5) }} 0 0; }
    </style>
</head>
<body>
    <div class="sheet">
        @if ($photo !== null)
            <div class="photo"><img src="{{ $photo }}" alt=""></div>
        @endif

        @if ($eyebrow !== null)
            <p class="eyebrow">{{ $eyebrow }}</p>
        @endif
        <p class="title">{{ $title }}</p>
        @if ($subline !== '')
            <p class="subline">{{ $subline }}</p>
        @endif

        <table class="columns">
            <tr>
                <td class="column column-left">
                    <h2>{{ __('signature.placard.specs') }}</h2>
                    @foreach ($spec_groups as $group)
                        <h3>{{ $group['label'] }}</h3>
                        <table>
                            @foreach ($group['rows'] as $row)
                                <tr class="row"><td>{{ $row['label'] }}</td><td class="value">{{ $row['value'] }}</td></tr>
                            @endforeach
                        </table>
                    @endforeach
                </td>
                <td class="column column-right">
                    <h2>{{ __('signature.placard.mods') }}</h2>
                    @forelse ($mod_groups as $group)
                        <h3>{{ $group['name'] }}</h3>
                        @foreach ($group['items'] as $item)
                            <p class="mod">{{ $item }}</p>
                        @endforeach
                        @if ($group['more'] > 0)
                            <p class="more">{{ trans_choice('signature.placard.more_mods', $group['more'], ['count' => $group['more']]) }}</p>
                        @endif
                    @empty
                        <p class="mod">{{ __('signature.placard.no_mods') }}</p>
                    @endforelse
                    @if ($mod_groups !== [])
                        <p class="small">{{ __('signature.placard.disclaimer') }}</p>
                    @endif
                </td>
            </tr>
        </table>

        <table class="footer">
            <tr>
                <td class="code-cell"><img src="{{ $qr_image }}" alt="{{ $code }}"></td>
                <td class="info-cell">
                    <img class="logo" src="{{ $logo }}" alt="SPEED CLUB">
                    <p class="scan">{{ __('signature.placard.scan') }}</p>
                    <p class="short-code">{{ $code }}</p>
                    <p class="small">{{ $url }}</p>
                    @if ($username !== null)
                        <p class="small">{{ __('signature.placard.owner', ['name' => $username]) }}</p>
                    @endif
                </td>
            </tr>
        </table>
    </div>
</body>
</html>
