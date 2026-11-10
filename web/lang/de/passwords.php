<?php

declare(strict_types=1);

return [
    'reset' => 'Dein Passwort wurde zurückgesetzt.',
    'sent' => 'Wir haben dir einen Link zum Zurücksetzen deines Passworts geschickt.',
    'throttled' => 'Warte kurz, bevor du es noch einmal versuchst.',
    'token' => 'Dieser Link zum Zurücksetzen ist ungültig oder abgelaufen. Fordere einen neuen an.',
    'user' => 'Zu dieser E-Mail-Adresse gibt es kein Konto.',

    'rules' => [
        'length' => 'Dein Passwort muss mindestens :min Zeichen lang sein.',
        'too_long' => 'Dein Passwort darf höchstens :max Zeichen lang sein.',
        'common' => 'Dieses Passwort ist zu verbreitet. Wähl ein anderes.',
        'same_as_email' => 'Dein Passwort darf nicht deine E-Mail-Adresse sein.',
        'same_as_username' => 'Dein Passwort darf nicht dein Benutzername sein.',
        'hash_shaped' => 'Das sieht wie ein Passwort-Hash aus und kann nicht dein Passwort sein. Wähl ein anderes.',
        'same_as_current' => 'Dein neues Passwort muss sich vom alten unterscheiden.',
    ],
];
