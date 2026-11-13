{{-- QR-02 sticker sheet, A6. Black on white only; the logo sits beside the code, never in it (02_PRODUCT_SPEC §3.4). --}}
<!DOCTYPE html>
<html lang="{{ app()->getLocale() }}">
<head>
    <meta charset="utf-8">
    <title>{{ __('public.sticker.title') }}</title>
    <style>
        @page { size: 105mm 148mm; margin: 0; }
        html, body { margin: 0; padding: 0; background: #ffffff; color: #000000; font-family: 'Inter', sans-serif; font-weight: 400; }
        .sheet { padding: 7mm 8mm; }
        table { border-collapse: collapse; width: 100%; }
        td { padding: 0; vertical-align: middle; }
        .code-cell { width: 56mm; }
        .code-cell img { width: 56mm; height: 56mm; display: block; }
        .logo-cell { padding-left: 4mm; text-align: center; }
        .logo-cell img { width: 23mm; height: auto; }
        .username { font-family: 'Inter Display', sans-serif; font-weight: 600; font-size: 22pt; line-height: 26pt; margin: 3mm 0 0; }
        .short-code { font-weight: 700; font-size: 15pt; line-height: 19pt; letter-spacing: 1pt; margin: 1mm 0 0; }
        .url { font-size: 8pt; line-height: 11pt; margin: 1mm 0 0; }
        /* Placement, print and disclaimer sentences of QR-03 (08_LEGAL §7) word for word as in the app; 8pt lines keep one page with about 3 mm to spare. */
        .hint { font-size: 6.5pt; line-height: 8pt; margin: 2mm 0 0; padding-top: 1.5mm; border-top: 0.5pt solid #000000; }
        .hint p { margin: 0 0 0.5mm; }
    </style>
</head>
<body>
    <div class="sheet">
        <table>
            <tr>
                <td class="code-cell"><img src="{{ $qr_image }}" alt="{{ $code }}"></td>
                <td class="logo-cell"><img src="{{ $logo }}" alt="SPEED CLUB"></td>
            </tr>
        </table>
        @if ($username !== null)
            <p class="username" style="font-size: {{ $username_size }}pt">{{ '@'.$username }}</p>
        @endif
        <p class="short-code">{{ $code }}</p>
        <p class="url">{{ $url }}</p>
        <div class="hint">
            <p>{{ __('public.sticker.placement') }}</p>
            <p>{{ __('public.sticker.print') }}</p>
            <p>{{ __('public.sticker.disclaimer') }}</p>
        </div>
    </div>
</body>
</html>
