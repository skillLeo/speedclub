<?php

namespace App\Http\Controllers\Api\V1\Config;

use App\Http\Controllers\Controller;
use App\Http\Resources\V1\AppConfigResource;
use App\Services\AppConfig\AppConfig;

class AppConfigController extends Controller
{
    /**
     * Runtime configuration of the apps.
     *
     * Public, with ETag. Poll on start and every 5 minutes in the foreground; keep the last good answer.
     *
     * @unauthenticated
     */
    public function show(AppConfig $config): AppConfigResource
    {
        return new AppConfigResource($config->forLocale(app()->getLocale()));
    }
}
