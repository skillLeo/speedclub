<?php

use App\Models\Staff;
use App\Services\Audit\Audit;
use App\Services\Audit\AuditChain;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\Storage;

/**
 * Runs on committed rows because the archive step needs the real triggers, and DDL would end the test transaction.
 */
beforeEach(function () {
    DB::rollBack();
    Storage::fake(config('speedclub.media.private_disk'));
});

afterEach(function () {
    DB::unprepared('DROP TRIGGER IF EXISTS audit_events_no_update');
    DB::unprepared('DROP TRIGGER IF EXISTS audit_events_no_delete');
    DB::unprepared('TRUNCATE TABLE audit_events');
    DB::unprepared('TRUNCATE TABLE audit_event_access');
    DB::table('audit_chain_head')->update(['last_event_id' => null, 'hash' => null, 'archived_through_id' => null, 'archived_hash' => null]);

    foreach (AuditChain::triggerStatements() as $statement) {
        DB::unprepared($statement);
    }

    DB::table('staff')->delete();
    Carbon\Carbon::setTestNow();
});

function auditEventsAt(string ...$dates): void
{
    foreach ($dates as $index => $date) {
        Carbon\Carbon::setTestNow($date);
        Audit::record("event.$index");
    }

    Carbon\Carbon::setTestNow();
}

it('removes staff access data after 12 months and leaves the chain intact', function () {
    $staff = Staff::factory()->create();

    Carbon\Carbon::setTestNow(now()->subMonths(13));
    Audit::record('old', actor: $staff);
    Carbon\Carbon::setTestNow(now()->addMonths(12));
    Audit::record('recent', actor: $staff);
    Carbon\Carbon::setTestNow();

    $this->artisan('audit:retention')->assertSuccessful();

    expect(DB::table('audit_event_access')->count())->toBe(1)
        ->and(DB::table('audit_events')->count())->toBe(2)
        ->and(AuditChain::verify()->intact)->toBeTrue();
});

it('moves events older than 24 months to the archive and the chain still verifies', function () {
    auditEventsAt(now()->subMonths(30)->toDateTimeString(), now()->subMonths(25)->toDateTimeString(), now()->subMonth()->toDateTimeString());

    $this->artisan('audit:retention')->assertSuccessful();

    expect(DB::table('audit_events')->count())->toBe(1)
        ->and(DB::table('audit_events')->value('action'))->toBe('event.2');

    $files = Storage::disk(config('speedclub.media.private_disk'))->files('audit/archive');
    $lines = explode("\n", trim(Storage::disk(config('speedclub.media.private_disk'))->get($files[0])));

    expect($files)->toHaveCount(1)
        ->and($lines)->toHaveCount(2)
        ->and(json_decode($lines[0], true)['action'])->toBe('event.0');

    $this->artisan('audit:verify')->assertSuccessful();

    Audit::record('next');

    expect(AuditChain::verify())->intact->toBeTrue()->checked->toBe(2);
});

it('verifies when every event has been archived', function () {
    auditEventsAt(now()->subMonths(30)->toDateTimeString());

    $this->artisan('audit:retention')->assertSuccessful();

    expect(DB::table('audit_events')->count())->toBe(0)
        ->and(AuditChain::verify()->intact)->toBeTrue();
});

it('refuses to archive a broken chain', function () {
    auditEventsAt(now()->subMonths(30)->toDateTimeString(), now()->subMonths(29)->toDateTimeString());

    DB::unprepared('DROP TRIGGER audit_events_no_update');
    DB::table('audit_events')->orderBy('id')->limit(1)->update(['action' => 'forged']);

    $this->artisan('audit:retention')->assertFailed();

    expect(DB::table('audit_events')->count())->toBe(2)
        ->and(Storage::disk(config('speedclub.media.private_disk'))->files('audit/archive'))->toBe([]);
});

it('detects old events removed without moving the checkpoint', function () {
    auditEventsAt(now()->subMonths(30)->toDateTimeString(), now()->subMonth()->toDateTimeString());

    DB::unprepared('DROP TRIGGER audit_events_no_delete');
    DB::table('audit_events')->orderBy('id')->limit(1)->delete();

    expect(AuditChain::verify())->intact->toBeFalse()->failure->toBe('prev_hash');
});

it('still rejects updates and direct deletes in the database', function () {
    Audit::record('protected');

    expect(fn () => DB::table('audit_events')->update(['action' => 'x']))->toThrow(QueryException::class)
        ->and(fn () => DB::table('audit_events')->delete())->toThrow(QueryException::class);

    expect(DB::selectOne('SELECT '.AuditChain::ARCHIVE_VARIABLE.' AS value')->value)->toBeNull();
});

it('deletes daily exports after 24 months and archives after 36', function () {
    $disk = Storage::disk(config('speedclub.media.private_disk'));

    $disk->put('audit/'.now()->subMonths(25)->format('Y-m-d').'.jsonl', 'old');
    $disk->put('audit/'.now()->subMonths(23)->format('Y-m-d').'.jsonl', 'new');
    $disk->put('audit/archive/'.now()->subMonths(37)->format('Y-m-d').'-5.jsonl', 'old');
    $disk->put('audit/archive/'.now()->subMonths(35)->format('Y-m-d').'-9.jsonl', 'new');

    $this->artisan('audit:retention')->assertSuccessful();

    expect($disk->files('audit'))->toBe(['audit/'.now()->subMonths(23)->format('Y-m-d').'.jsonl'])
        ->and($disk->files('audit/archive'))->toBe(['audit/archive/'.now()->subMonths(35)->format('Y-m-d').'-9.jsonl']);
});

it('keeps access data out of the daily export', function () {
    Audit::record('staff.action', actor: Staff::factory()->create());

    $this->artisan('audit:export', ['--date' => now()->toDateString()])->assertSuccessful();

    $contents = Storage::disk(config('speedclub.media.private_disk'))->get('audit/'.now()->format('Y-m-d').'.jsonl');

    expect($contents)->toContain('staff.action')->not->toContain('"ip"')->not->toContain('user_agent');
});
