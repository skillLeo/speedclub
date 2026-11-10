<?php

use App\Http\BoundedRequest;
use Illuminate\Contracts\Http\Kernel;
use Symfony\Component\HttpFoundation\Request;

/**
 * One request in a process of its own, under the memory limit it was started with, so running out of memory shows as a failed process
 * and not as a dead test worker. Prints the status. Takes the route, the character of the address and how many of them. PHP fills the
 * same input bag from a form and from a multipart body, so this stands for both.
 */
$basePath = dirname(__DIR__, 4);

require $basePath.'/vendor/autoload.php';

$app = require $basePath.'/bootstrap/app.php';

$response = $app->make(Kernel::class)->handle(BoundedRequest::createFromBase(Request::create((string) $argv[1], 'POST', [
    'email' => str_repeat((string) $argv[2], (int) $argv[3]),
    'password' => 'x',
    'device_name' => 'P',
], [], [], [
    'CONTENT_TYPE' => 'application/x-www-form-urlencoded',
    'HTTP_ACCEPT' => 'application/json',
])));

echo $response->getStatusCode();
