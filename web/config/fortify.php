<?php

use App\Http\Middleware\EnsureStaffTwoFactor;
use App\Http\Middleware\LimitStaffStepInput;
use App\Http\Middleware\RejectNonStringCredentials;
use Laravel\Fortify\Features;

return [

    /*
    |--------------------------------------------------------------------------
    | Fortify Guard
    |--------------------------------------------------------------------------
    |
    | Here you may specify which authentication guard Fortify will use while
    | authenticating users. This value should correspond with one of your
    | guards that is already present in your "auth" configuration file.
    |
    */

    'guard' => 'staff',

    /*
    |--------------------------------------------------------------------------
    | Fortify Password Broker
    |--------------------------------------------------------------------------
    |
    | Here you may specify which password broker Fortify can use when a user
    | is resetting their password. This configured value should match one
    | of your password brokers setup in your "auth" configuration file.
    |
    */

    'passwords' => 'staff',

    /*
    |--------------------------------------------------------------------------
    | Username / Email
    |--------------------------------------------------------------------------
    |
    | This value defines which model attribute should be considered as your
    | application's "username" field. Typically, this might be the email
    | address of the users but you are free to change this value here.
    |
    | Out of the box, Fortify expects forgot password and reset password
    | requests to have a field named 'email'. If the application uses
    | another name for the field you may define it below as needed.
    |
    */

    'username' => 'email',

    'email' => 'email',

    /*
    |--------------------------------------------------------------------------
    | Lowercase Usernames
    |--------------------------------------------------------------------------
    |
    | This value defines whether usernames should be lowercased before saving
    | them in the database, as some database system string fields are case
    | sensitive. You may disable this for your application if necessary.
    |
    */

    'lowercase_usernames' => true,

    /*
    |--------------------------------------------------------------------------
    | Home Path
    |--------------------------------------------------------------------------
    |
    | Here you may configure the path where users will get redirected during
    | authentication or password reset when the operations are successful
    | and the user is authenticated. You are free to change this value.
    |
    */

    'home' => '/admin',

    /*
    |--------------------------------------------------------------------------
    | Fortify Routes Prefix / Subdomain
    |--------------------------------------------------------------------------
    |
    | Here you may specify which prefix Fortify will assign to all the routes
    | that it registers with the application. If necessary, you may change
    | subdomain under which all of the Fortify routes will be available.
    |
    */

    'redirects' => [
        'logout' => '/admin/login',
        'password-reset' => '/admin/login',
    ],

    'prefix' => 'admin',

    // SEC-P1-07: the reset page (route password.reset) takes no token in its path. The mailed link carries token and address in the
    // fragment (/admin/reset#token=…&email=…), which no browser sends to a server or writes to an access log; the page reads it and
    // posts both with the new password to password.update (POST /admin/reset-password). FortifyServiceProvider builds that link.
    'paths' => [
        'password' => ['reset' => '/reset'],
    ],

    'domain' => null,

    /*
    |--------------------------------------------------------------------------
    | Fortify Routes Middleware
    |--------------------------------------------------------------------------
    |
    | Here you may specify which middleware Fortify will assign to the routes
    | that it registers with the application. If necessary, you may change
    | these middleware but typically this provided default is preferred.
    |
    */

    // LimitStaffStepInput: at most 16 KB of input, ahead of the session and the limiters (SEC-P1-43).
    // RejectNonStringCredentials: Fortify's steps need strings (SEC-P1-40).
    // EnsureStaffTwoFactor: no Fortify step past enrolment without confirmed TOTP (SEC-P1-01).
    'middleware' => ['web', 'staff', LimitStaffStepInput::class, RejectNonStringCredentials::class, EnsureStaffTwoFactor::class],

    /*
    |--------------------------------------------------------------------------
    | Rate Limiting
    |--------------------------------------------------------------------------
    |
    | By default, Fortify will throttle logins to five requests per minute for
    | every email and IP address combination. However, if you would like to
    | specify a custom rate limiter to call then you may specify it here.
    |
    */

    'limiters' => [
        'login' => 'login',
        'two-factor' => 'two-factor',
    ],

    /*
    |--------------------------------------------------------------------------
    | Register View Routes
    |--------------------------------------------------------------------------
    |
    | Here you may specify if the routes returning views should be disabled as
    | you may not need them when building your own application. This may be
    | especially true if you're writing a custom single-page application.
    |
    */

    // ADM-01…04 are Inertia pages rendered by the view callbacks in FortifyServiceProvider. With the views on, every route name Fortify
    // redirects to exists (login, two-factor.login, password.request, password.reset, password.confirm), so no browser form ends in a
    // 500 (SEC-P1-30).
    'views' => true,

    /*
    |--------------------------------------------------------------------------
    | Passkeys
    |--------------------------------------------------------------------------
    |
    | These settings configure Fortify's passkey (WebAuthn) support. Passkeys
    | allow users to sign in without needing to remember credentials since
    | they use public-key cryptography - making them immune to breaches.
    |
    */

    /*
    |--------------------------------------------------------------------------
    | Features
    |--------------------------------------------------------------------------
    |
    | Some of the Fortify features are optional. You may disable the features
    | by removing them from this array. You're free to only remove some of
    | these features or you can even remove all of these if you need to.
    |
    */

    'features' => [
        Features::resetPasswords(),
        Features::updatePasswords(),
        Features::twoFactorAuthentication([
            'confirm' => true,
            'confirmPassword' => true,
            // 32 base32 characters = 160 bits, as RFC 4226 recommends (SEC-P1-38). Fortify's default is 80 bits.
            'secret-length' => 32,
        ]),
    ],

];
