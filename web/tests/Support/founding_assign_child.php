<?php

/**
 * A separate PHP process for FoundingConcurrencyTest: boots the app against the test database, waits for a common start moment and
 * assigns Founding Member numbers to the given members one after the other, each in its own transaction (FoundingNumbers::assign).
 * Prints the numbers comma separated, or "error:<class>:<message>".
 *
 * argv: base path, start (unix time with microseconds), member ids comma separated.
 */

use App\Models\User;
use App\Services\Members\FoundingNumbers;
use Illuminate\Contracts\Console\Kernel;

require $argv[1].'/vendor/autoload.php';
$app = require $argv[1].'/bootstrap/app.php';
$app->make(Kernel::class)->bootstrap();
// The children run under APP_ENV=testing; the numbers are production-only outside this test.
config(['speedclub.founding.environments' => ['testing']]);

while (microtime(true) < (float) $argv[2]) {
    usleep(500);
}

try {
    $numbers = [];

    foreach (explode(',', $argv[3]) as $id) {
        $numbers[] = (string) $app->make(FoundingNumbers::class)->assign(User::query()->findOrFail($id));
    }

    echo implode(',', $numbers);
} catch (Throwable $exception) {
    echo 'error:'.$exception::class.':'.$exception->getMessage();
}
