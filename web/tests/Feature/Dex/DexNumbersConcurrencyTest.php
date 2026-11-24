<?php

use App\Services\Dex\DexNumbers;
use Illuminate\Database\Connection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * M5.9b Dex numbers under parallel allocation (the deadlock pattern M5.9d's founding test found): 50 vehicles numbered at the same moment
 * by 10 separate PHP processes (tests/Support/dex_number_child.php, 5 vehicles each, one common start) get 50 unique numbers 1–50
 * without a gap. The rows are written and removed through a connection of their own, outside the RefreshDatabase transaction; the
 * counter goes back to what it was. The counter row is missing at the start, so the first allocations also race to create it.
 */
function dexNumbersProbe(): Connection
{
    config(['database.connections.dex_numbers_probe' => config('database.connections.'.config('database.default'))]);

    return DB::connection('dex_numbers_probe');
}

it('gives 50 parallel first publishes 50 unique Dex numbers 1–50 without a gap', function () {
    $probe = dexNumbersProbe();
    $before = $probe->table('sequence_counters')->where('key', DexNumbers::COUNTER)->value('value');
    $probe->table('sequence_counters')->where('key', DexNumbers::COUNTER)->delete();
    expect($probe->table('vehicles')->whereNotNull('dex_number')->count())->toBe(0);

    $ownerId = strtolower((string) Str::ulid());
    $probe->table('users')->insert([
        'id' => $ownerId, 'email' => 'dex-owner-'.Str::lower(Str::random(6)).'@garage.test', 'username' => 'dexowner'.Str::lower(Str::random(5)),
        'email_verified_at' => now(), 'created_at' => now(), 'updated_at' => now(),
    ]);
    $ids = [];

    foreach (range(1, 50) as $i) {
        $id = strtolower((string) Str::ulid());
        $publicId = strtoupper(Str::random(8));
        $probe->table('vehicles')->insert([
            'id' => $id, 'owner_id' => $ownerId, 'public_id' => $publicId, 'slug' => 'dex-'.$i.'-'.strtolower($publicId),
            'status' => 'published', 'published_at' => now(), 'created_at' => now(), 'updated_at' => now(),
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
            $process = proc_open([PHP_BINARY, base_path('tests/Support/dex_number_child.php'), base_path(), $start, implode(',', $chunk)], [1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes, base_path(), $env);
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
        $stored = $probe->table('vehicles')->whereIn('id', $ids)->orderBy('dex_number')->pluck('dex_number')->map(fn ($n): int => (int) $n)->all();

        expect(collect($answers)->filter(fn (string $a): bool => str_starts_with($a, 'error:'))->all())->toBe([])
            ->and($numbers)->toBe(range(1, 50))
            ->and($stored)->toBe(range(1, 50))
            ->and((int) $probe->table('sequence_counters')->where('key', DexNumbers::COUNTER)->value('value'))->toBe(50);
    } finally {
        $probe->table('vehicles')->whereIn('id', $ids)->delete();
        $probe->table('users')->where('id', $ownerId)->delete();
        $probe->table('sequence_counters')->where('key', DexNumbers::COUNTER)->delete();

        if ($before !== null) {
            $probe->table('sequence_counters')->insert(['key' => DexNumbers::COUNTER, 'value' => $before]);
        }
    }
})->group('concurrency');
