<?php

// Only admin routes reach the admin bundle; API and public routes stay out of the page source.
return [
    'only' => [
        'admin.*',
        // Fortify's sign-in page (views on, M3.1).
        'login',
        'login.store',
        'logout',
        'password.*',
        'two-factor.*',
        'user-password.*',
    ],

    // SEC-P3-04: what a guest, a staff member before TOTP, or an error page outside the session may see (App\Http\Controllers\Admin\Support\ZiggyScope).
    'groups' => [
        'guest' => [
            'login',
            'login.store',
            'logout',
            'admin.login',
            'admin.two-factor.setup',
            'admin.session.keep-alive',
            'password.*',
            'two-factor.*',
        ],
    ],
];
