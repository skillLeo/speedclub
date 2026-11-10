<?php

use App\Providers\AdminServiceProvider;
use App\Providers\AiServiceProvider;
use App\Providers\AppServiceProvider;
use App\Providers\ConsentServiceProvider;
use App\Providers\FortifyServiceProvider;
use App\Providers\HealthServiceProvider;
use App\Providers\ViewAsServiceProvider;

return [
    AppServiceProvider::class,
    FortifyServiceProvider::class,
    AdminServiceProvider::class,
    HealthServiceProvider::class,
    ViewAsServiceProvider::class,
    AiServiceProvider::class,
    ConsentServiceProvider::class,
];
