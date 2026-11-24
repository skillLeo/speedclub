{{-- ADR-539: the answer of /internal/maintenance/{token}/on|off. Plain on purpose (see internal/setup). --}}
<!doctype html>
<html lang="de">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="robots" content="noindex, nofollow">
    <title>SPEED CLUB · Wartungsmodus</title>
</head>
<body>
<main>
    <h1>Wartungsmodus: {{ $down ? 'AN' : 'aus' }}</h1>
    @if (! $ok)
        <p>Das Umschalten hat nicht geklappt. Schreibrechte von /speedclub/storage/framework prüfen.</p>
    @elseif ($down)
        <p>Besucher sehen jetzt „Gleich zurück“. Jetzt die geänderten Dateien hochladen und danach die Einrichtung starten (/internal/setup/…): sie schaltet den Wartungsmodus am Ende selbst aus.</p>
    @else
        <p>Die Seite ist wieder für alle erreichbar.</p>
    @endif
</main>
</body>
</html>
