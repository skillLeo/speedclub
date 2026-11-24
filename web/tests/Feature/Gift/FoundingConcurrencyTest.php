<?php

use App\Services\Members\FoundingNumbers;
use Illuminate\Database\Connection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * M5.9d (m5.9d contract §4, §9): 50 activations at the same moment get 50 unique Founding Member numbers without a gap.
 *
 * How it runs in parallel inside Pest: the test writes 50 members through a connection of its own (outside the RefreshDatabase
 * transaction, so other processes see them), starts 10 separate PHP processes (tests/Support/founding_assign_child.php) against the
 * same lane database, each with 5 members, all waiting for one common start moment; each assigns its members one after the other, so
 * up to 10 assignments race for the counter's row lock at any time. Afterwards the committed rows are removed through the same side
 * connection and the counter goes back to what it was.
 */
function foundingProbe(): Connection
{
    config(['database.connections.founding_probe' => config('database.connections.'.config('database.default'))]);

    return DB::connection('founding_probe');
}

it('gives 50 parallel activations 50 unique numbers 1–50 without a gap', function () {
    $probe = foundingProbe();
    $before = $probe->table('sequence_counters')->where('key', FoundingNumbers::COUNTER)->value('value');
    $probe->table('sequence_counters')->where('key', FoundingNumbers::COUNTER)->delete();
    expect($probe->table('users')->whereNotNull('founding_number')->count())->toBe(0);

    $ids = [];

    foreach (range(1, 50) as $i) {
        $id = strtolower((string) Str::ulid());
        $probe->table('users')->insert([
            'id' => $id,
            'email' => "founding-$i-".Str::lower(Str::random(6)).'@garage.test',
            'username' => 'founding'.$i.Str::lower(Str::random(5)),
            'email_verified_at' => now(),
            'terms_version' => '1',
            'privacy_version' => '1',
            'consented_at' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $ids[] = $id;
    }

    $start = sprintf('%.6F', microtime(true) + 3.0);
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

    try {
        $processes = [];

        foreach (array_chunk($ids, 5) as $chunk) {
            $pipes = [];
            $process = proc_open([PHP_BINARY, base_path('tests/Support/founding_assign_child.php'), base_path(), $start, implode(',', $chunk)], [1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes, base_path(), $env);
            expect($process)->not->toBeFalse();
            $processes[] = [$process, $pipes];
        }

        $answers = [];

        foreach ($processes as [$process, $pipes]) {
            $answers[] = trim((string) stream_get_contents($pipes[1])).trim((string) stream_get_contents($pipes[2]));
            proc_close($process);
        }

        $numbers = array_map(intval(...), explode(',', implode(',', $answers)));
        sort($numbers);
        $stored = $probe->table('users')->whereIn('id', $ids)->orderBy('founding_number')->pluck('founding_number')->map(fn ($n): int => (int) $n)->all();

        expect(collect($answers)->filter(fn (string $a): bool => str_starts_with($a, 'error:'))->all())->toBe([])
            ->and($numbers)->toBe(range(1, 50))
            ->and($stored)->toBe(range(1, 50))
            ->and((int) $probe->table('sequence_counters')->where('key', FoundingNumbers::COUNTER)->value('value'))->toBe(50);
    } finally {
        $probe->table('users')->whereIn('id', $ids)->delete();
        $probe->table('sequence_counters')->where('key', FoundingNumbers::COUNTER)->delete();

        if ($before !== null) {
            $probe->table('sequence_counters')->insert(['key' => FoundingNumbers::COUNTER, 'value' => $before]);
        }
    }
})->group('concurrency');
