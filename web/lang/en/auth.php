<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Authentication Language Lines
    |--------------------------------------------------------------------------
    |
    | The following language lines are used during authentication for various
    | messages that we need to display to the user. You are free to modify
    | these language lines according to your application's requirements.
    |
    */

    'failed' => 'E-mail address or password is incorrect.',
    'password' => 'The password is incorrect.',
    'throttle' => 'Too many sign-in attempts. Try again in :seconds seconds.',

    // M4.6 AUTH-13.
    'email_code' => [
        'wrong' => '{0} That code is not right. Request a new one.|{1} That code is not right. :count attempt left.|[2,*] That code is not right. :count attempts left.',
    ],
];
