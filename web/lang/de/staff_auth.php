<?php

// Staff portal (Fortify, guard staff). The answers stay the same whether or not an address belongs to staff (SEC-P1-02).
return [
    'reset_link_requested' => 'Wenn zu dieser Adresse ein Team-Konto gehört, ist ein Link zum Zurücksetzen unterwegs. Er gilt :duration.',
    'reset_failed' => 'Dieser Link ist ungültig oder abgelaufen. Fordere einen neuen an.',
    // M3.1 sign-in hardening.
    'password_proof_required' => 'Lege zuerst über „Passwort vergessen?“ ein eigenes Passwort fest. Der Link kommt per E-Mail an diese Adresse.',
    'session_ended' => 'Du wurdest abgemeldet, weil sich das Passwort, die Zwei-Faktor-Einstellungen oder der Status deines Kontos geändert haben.',
    'password_check_locked' => 'Zu viele falsche Passwörter. Versuch es in :time noch einmal.',
];
