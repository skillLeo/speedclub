<!doctype html>
<html lang="{{ app()->getLocale() }}">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="light">
    <title>{{ $heading }}</title>
</head>
<body style="margin:0;padding:0;background-color:{{ $colors['canvas'] }};">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:{{ $colors['canvas'] }};">
        <tr>
            <td align="center" style="padding:24px 16px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background-color:{{ $colors['surface'] }};border:1px solid {{ $colors['border'] }};border-radius:12px;">
                    <tr>
                        <td style="padding:32px 24px;font-family:{{ $colors['font'] }};color:{{ $colors['text'] }};">
                            <a href="{{ $homeUrl }}"><img src="{{ $logoUrl }}" width="120" height="36" alt="SPEED CLUB" style="display:block;border:0;width:120px;height:auto;"></a>
                            <h1 style="margin:24px 0 12px;font-size:22px;line-height:28px;font-weight:600;">{{ $heading }}</h1>
                            @foreach ($lines as $line)
                                <p style="margin:0 0 16px;font-size:16px;line-height:24px;color:{{ $colors['secondary'] }};">{{ $line }}</p>
                            @endforeach
                            @if ($code !== null)
                                <p style="margin:24px 0;font-size:32px;line-height:40px;font-weight:700;letter-spacing:8px;font-variant-numeric:tabular-nums;font-feature-settings:'tnum';">{{ $code }}</p>
                            @endif
                            @foreach ($actions as $action)
                                <p style="margin:0 0 12px;"><a href="{{ $action['url'] }}" style="display:inline-block;padding:12px 16px;border-radius:8px;background-color:{{ $colors['accent'] }};color:{{ $colors['on_accent'] }};font-size:16px;line-height:24px;font-weight:600;text-decoration:none;">{{ $action['label'] }}</a></p>
                            @endforeach
                            @if ($note !== null)
                                <p style="margin:24px 0 0;font-size:14px;line-height:20px;color:{{ $colors['tertiary'] }};">{{ $note }}</p>
                            @endif
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>
