{{-- ADR-539: the web installer of a host without SSH (DEPLOY_ALLINKL.md). Deliberately plain: no assets, no session, no cookie,
     no database reads beyond the state line, so it works before the first migration and with an empty APP_KEY. --}}
<!doctype html>
<html lang="de">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="robots" content="noindex, nofollow">
    <title>SPEED CLUB · Einrichtung</title>
</head>
<body>
<main>
    <h1>SPEED CLUB · Einrichtung</h1>

    <h2>Stand</h2>
    <ul>
        @foreach ($package as $line)
            <li>{{ $line }}</li>
        @endforeach
        <li>Datenbank: {{ $database['detail'] }}</li>
        <li>Wartungsmodus: {{ $down ? 'AN' : 'aus' }}</li>
    </ul>

    @if ($result === null)
        <p>Führt aus: App-Schlüssel prüfen, Wartungsmodus an, Datenbank-Migrationen, Grunddaten (bei leerer Datenbank) oder neue Einträge (Update), Foto-Ordner, Caches, Wartungsmodus aus, Prüfung (Doctor). Dauert meist unter einer Minute. Bitte die Seite währenddessen offen lassen.</p>
        <form method="post" action="{{ url()->current() }}">
            <button type="submit">Einrichtung starten</button>
        </form>
    @elseif ($result['ok'])
        <h2>Fertig</h2>
        <p>Die Einrichtung ist durchgelaufen. Unten steht die Prüfung (Doctor): „No blockers“ heißt alles gut, „WARN“-Zeilen sind Hinweise.</p>
        <p>Diese Adresse ist ab jetzt gesperrt (404). Für die nächste Einrichtung oder ein Update einen neuen SETUP_TOKEN in die .env schreiben.</p>
    @else
        <h2>Nicht fertig</h2>
        <p>Bitte den Text unten lesen. Die Einrichtung darf erneut gestartet werden; jeder Schritt verträgt eine Wiederholung. Bei einer fehlgeschlagenen Migration bleibt der Wartungsmodus an: erst die Datenbank aus der Sicherung zurückspielen (DEPLOY_ALLINKL.md, Rollback).</p>
        <form method="post" action="{{ url()->current() }}">
            <button type="submit">Einrichtung erneut starten</button>
        </form>
    @endif

    @if ($result !== null)
        <h2>Protokoll</h2>
        <pre>{{ implode("\n", $result['lines']) }}</pre>
    @endif
</main>
</body>
</html>
