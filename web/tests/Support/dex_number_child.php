<?php

/**
 * A separate PHP process for DexNumbersConcurrencyTest: boots the app against the test database, waits for a common start moment and
 * gives the listed vehicles their Dex numbers one after the other (DexNumbers::ensure, each in its own transaction). Prints the numbers
 * comma separated, or "error:<class>:<message>".
 *
 * argv: base path, start (unix time with microseconds), vehicle ids comma separated.
 */

use App\Models\Vehicle;
use App\Services\Dex\DexNumbers;
use Illuminate\Contracts\Console\Kernel;

require $argv[1].'/vendor/autoload.php';
$app = require $argv[1].'/bootstrap/app.php';
$app->make(Kernel::class)->bootstrap();

while (microtime(true) < (float) $argv[2]) {
    usleep(500);
}

try {
    $numbers = [];

    foreach (explode(',', $argv[3]) as $id) {
        $numbers[] = (string) $app->make(DexNumbers::class)->ensure(Vehicle::query()->findOrFail($id));
    }

    echo implode(',', $numbers);
} catch (Throwable $exception) {
    echo 'error:'.$exception::class.':'.$exception->getMessage();
}
