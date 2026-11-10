<?php

use App\Models\User;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Log;

/**
 * BL-2 (M2.8 check): a database message quotes values ("Duplicate entry 'lukas@example.de' for key …"). Neither failed_jobs.exception
 * nor the log may keep it, also when the query error is the cause of another exception. The log gets the SQL with placeholders and
 * the SQLSTATE code (QueryExceptionReporter, SEC-106); failed_jobs gets ScrubbedException's summary (ScrubbingFailedJobProvider).
 */
final class ScrubDuplicateUserJob implements ShouldQueue
{
    use Queueable;

    public int $tries = 1;

    public function __construct(public readonly string $email, public readonly bool $wrap) {}

    public function handle(): void
    {
        try {
            User::factory()->create(['email' => $this->email]);
        } catch (QueryException $exception) {
            if (! $this->wrap) {
                throw $exception;
            }

            throw new RuntimeException('Konto konnte nicht kopiert werden.', 0, $exception);
        }
    }
}

beforeEach(function () {
    $this->log = storage_path('logs/scrub-'.bin2hex(random_bytes(4)).'.log');
    config([
        'logging.default' => 'scrub_test',
        'logging.channels.scrub_test' => ['driver' => 'single', 'path' => $this->log, 'level' => 'debug'],
        // As outside local and testing (config/database.php, SEC-106).
        'database.connections.mysql.mask_bindings_in_exception_messages' => true,
    ]);
    Log::forgetChannel('scrub_test');
    $this->email = 'lukas.geheim@example.de';
    User::factory()->create(['email' => $this->email]);
});

afterEach(function () {
    File::delete($this->log);
});

it('keeps the quoted value out of the log and failed_jobs, for a query error and for one that caused another exception', function (bool $wrap) {
    dispatch(new ScrubDuplicateUserJob($this->email, $wrap))->onConnection('database');
    $this->artisan('queue:work', ['connection' => 'database', '--once' => true, '--tries' => 1, '--stop-when-empty' => true]);

    $log = File::exists($this->log) ? File::get($this->log) : '';
    $failed = DB::table('failed_jobs')->sole();

    expect($log)->toContain('Database query failed.')
        ->and($log)->toContain('"sqlstate":"23000"')
        ->and($log)->toContain('insert into `users`')
        ->and($log)->not->toContain('lukas.geheim')
        ->and($log)->not->toContain('Duplicate entry')
        ->and($failed->exception)->toContain('(code 23000)')
        ->and($failed->exception)->not->toContain('lukas.geheim')
        ->and($failed->exception)->not->toContain('Duplicate entry');

    if ($wrap) {
        expect($log)->toContain('"exception_class":"RuntimeException"')
            ->and($failed->exception)->toStartWith('RuntimeException (code 0)')
            ->and($failed->exception)->toContain('Caused by: Illuminate\Database\UniqueConstraintViolationException');
    }
})->with(['query error' => false, 'as the cause' => true]);

it('reports an exception without a query error in its chain as before', function () {
    report(new RuntimeException('Ein ganz normaler Fehler'));

    expect(File::get($this->log))->toContain('Ein ganz normaler Fehler')->not->toContain('Database query failed.');
});

it('leaves local and test logs alone when the bindings are not masked', function () {
    config(['database.connections.mysql.mask_bindings_in_exception_messages' => false]);

    try {
        User::factory()->create(['email' => $this->email]);
    } catch (QueryException $exception) {
        report(new RuntimeException('wrapped', 0, $exception));
    }

    expect(File::get($this->log))->toContain('wrapped')->not->toContain('Database query failed.');
});
