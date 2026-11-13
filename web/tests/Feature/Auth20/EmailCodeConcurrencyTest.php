<?php

use App\Enums\ErrorCode;
use App\Enums\LoginPurpose;
use App\Exceptions\ApiException;
use App\Services\Auth\EmailCodes;
use Illuminate\Database\Connection;
use Illuminate\Support\Facades\DB;

/**
 * M4.6 app-lane bug: three parallel POST auth/email/start for one address deadlocked in login_attempts (gap locks of SELECT … FOR UPDATE
 * on an address without rows) and answered 500. EmailCodes::issue now serialises per address with a named lock.
 */
function ecProbe(): Connection
{
    config(['database.connections.ec_probe' => config('database.connections.'.config('database.default'))]);

    return DB::connection('ec_probe');
}

it('issues one code and answers the others neutrally when three processes ask at the same moment', function () {
    $email = 'parallel-'.bin2hex(random_bytes(4)).'@beispiel.test';
    $start = sprintf('%.6F', microtime(true) + 2.5);
    $env = [
        ...getenv(),
        'APP_ENV' => 'testing',
        'APP_KEY' => config()->string('app.key'),
        'DB_CONNECTION' => config()->string('database.default'),
        'DB_DATABASE' => (string) config('database.connections.'.config('database.default').'.database'),
        'CACHE_STORE' => 'array',
        'QUEUE_CONNECTION' => 'sync',
        'MAIL_MAILER' => 'array',
    ];

    $processes = [];

    foreach (range(1, 3) as $i) {
        $pipes = [];
        $process = proc_open([PHP_BINARY, base_path('tests/Support/email_code_issue_child.php'), base_path(), $start, $email], [1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes, base_path(), $env);
        expect($process)->not->toBeFalse();
        $processes[] = [$process, $pipes];
    }

    $answers = [];

    foreach ($processes as [$process, $pipes]) {
        $answers[] = trim((string) stream_get_contents($pipes[1])).trim((string) stream_get_contents($pipes[2]));
        proc_close($process);
    }

    // Committed by the children, outside this test's transaction: removed through a connection of its own.
    ecProbe()->table('login_attempts')->where('email_hash', EmailCodes::emailHash($email))->delete();

    sort($answers);
    expect($answers)->toBe(['issued', 'neutral', 'neutral']);
})->group('concurrency');

it('waits for a parallel request of the same address and answers 503 when it cannot get its turn', function () {
    config(['speedclub.email_code.lock_wait_seconds' => 0]);
    $email = 'gesperrt@beispiel.test';
    $lock = 'sc-email-code:'.substr(EmailCodes::emailHash($email), 0, 40);
    expect((int) ecProbe()->scalar('SELECT GET_LOCK(?, 0)', [$lock]))->toBe(1);

    try {
        app(EmailCodes::class)->issue($email, 'attempt-1', LoginPurpose::SignIn, null);
        $this->fail('expected 503');
    } catch (ApiException $exception) {
        expect($exception->errorCode)->toBe(ErrorCode::ServiceUnavailable);
    } finally {
        ecProbe()->scalar('SELECT RELEASE_LOCK(?)', [$lock]);
    }

    expect(app(EmailCodes::class)->issue($email, 'attempt-2', LoginPurpose::SignIn, null))->not->toBeNull()
        ->and((int) DB::scalar('SELECT IS_FREE_LOCK(?)', [$lock]))->toBe(1);
});
