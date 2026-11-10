<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Password Reset Language Lines
    |--------------------------------------------------------------------------
    |
    | The following language lines are the default lines which match reasons
    | that are given by the password broker for a password update attempt
    | outcome such as failure due to an invalid password / reset token.
    |
    */

    'reset' => 'Your password has been reset.',
    'sent' => 'We have emailed you a link to reset your password.',
    'throttled' => 'Wait a moment before you try again.',
    'token' => 'This reset link is invalid or has expired. Request a new one.',
    'user' => 'There is no account with this email address.',

    'rules' => [
        'length' => 'Your password must be at least :min characters long.',
        'too_long' => 'Your password must be at most :max characters long.',
        'common' => 'This password is too common. Choose another one.',
        'same_as_email' => 'Your password must not be your e-mail address.',
        'same_as_username' => 'Your password must not be your username.',
        'hash_shaped' => 'This looks like a password hash and cannot be your password. Choose another one.',
        'same_as_current' => 'Your new password must differ from the old one.',
    ],

];
