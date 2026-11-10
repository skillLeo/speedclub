<?php

use App\Http\BoundedRequest;
use App\Http\Middleware\LimitJsonBody;
use Illuminate\Contracts\Http\Kernel;
use Symfony\Component\HttpFoundation\Request;

/**
 * One request in a process of its own, under the memory limit it was started with, so running out of memory shows as a failed process
 * and not as a dead test worker. Prints the status. Takes the depth of the nested arrays that fill a body of exactly the limit.
 */
$basePath = dirname(__DIR__, 4);

require $basePath.'/vendor/autoload.php';

$app = require $basePath.'/bootstrap/app.php';

$depth = (int) ($argv[1] ?? 1);
$element = str_repeat('[', $depth).'0'.str_repeat(']', $depth);
$body = '['.implode(',', array_fill(0, (int) floor((LimitJsonBody::MAX_BYTES - 1) / (strlen($element) + 1)), $element)).']';

$response = $app->make(Kernel::class)->handle(BoundedRequest::createFromBase(Request::create('/api/v1/auth/login', 'POST', [], [], [], [
    'CONTENT_TYPE' => 'application/json',
    'CONTENT_LENGTH' => (string) strlen($body),
    'HTTP_ACCEPT' => 'application/json',
], $body)));

echo $response->getStatusCode();
