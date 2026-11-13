<?php

/**
 * A separate PHP process for EmailCodeConcurrencyTest: boots the app against the test database, waits for a common start moment and asks
 * for one e-mail code. Prints "issued", "neutral" or "error:<class>:<message>".
 *
 * argv: base path, start (unix time with microseconds), e-mail address.
 */

use App\Enums\LoginPurpose;
use App\Services\Auth\EmailCodes;
use Illuminate\Contracts\Console\Kernel;

require $argv[1].'/vendor/autoload.php';
$app = require $argv[1].'/bootstrap/app.php';
$app->make(Kernel::class)->bootstrap();

while (microtime(true) < (float) $argv[2]) {
    usleep(500);
}

try {
    $issued = $app->make(EmailCodes::class)->issue($argv[3], bin2hex(random_bytes(16)), LoginPurpose::SignIn, null);
    echo $issued === null ? 'neutral' : 'issued';
} catch (Throwable $exception) {
    echo 'error:'.$exception::class.':'.$exception->getMessage();
}
