<?php

// argon2id where the host's PHP has it, otherwise bcrypt cost 12 (02_PRODUCT_SPEC §3.1).
return [

    'driver' => env('HASH_DRIVER', defined('PASSWORD_ARGON2ID') ? 'argon2id' : 'bcrypt'),

    // verify stays off by default: a host change may switch the driver, and existing hashes must keep
    // working until rehash_on_login upgrades them at the next login.
    'bcrypt' => [
        'rounds' => env('BCRYPT_ROUNDS', 12),
        'verify' => env('HASH_VERIFY', false),
        'limit' => env('BCRYPT_LIMIT'),
    ],

    'argon' => [
        'memory' => env('ARGON_MEMORY', 65536),
        'threads' => env('ARGON_THREADS', 1),
        'time' => env('ARGON_TIME', 4),
        'verify' => env('HASH_VERIFY', false),
    ],

    'rehash_on_login' => true,

];
