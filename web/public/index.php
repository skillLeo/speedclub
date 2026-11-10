<?php

use App\Http\BoundedRequest;
use Illuminate\Foundation\Application;

define('LARAVEL_START', microtime(true));

// Determine if the application is in maintenance mode...
if (file_exists($maintenance = __DIR__.'/../storage/framework/maintenance.php')) {
    require $maintenance;
}

// Register the Composer autoloader...
require __DIR__.'/../vendor/autoload.php';

// Bootstrap Laravel and handle the request...
/** @var Application $app */
$app = require_once __DIR__.'/../bootstrap/app.php';

// Not Request::capture(): that decodes a JSON body of any size, ahead of the first middleware (SEC-P1-48).
$app->handleRequest(BoundedRequest::capture());
