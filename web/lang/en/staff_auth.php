<?php

// Staff portal (Fortify, guard staff). The answers stay the same whether or not an address belongs to staff (SEC-P1-02).
return [
    'reset_link_requested' => 'If a team account belongs to this address, a reset link is on its way. It is valid for :duration.',
    'reset_failed' => 'This link is invalid or has expired. Request a new one.',
    // M3.1 sign-in hardening.
    'password_proof_required' => 'First set a password of your own through “Forgot password?”. The link is sent to this address.',
    'session_ended' => 'You were signed out because the password, the two-factor settings or the status of your account changed.',
    'password_check_locked' => 'Too many wrong passwords. Try again in :time.',
];
