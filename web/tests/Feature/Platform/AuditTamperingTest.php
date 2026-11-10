<?php

use App\Services\Audit\Audit;
use App\Services\Audit\AuditChain;
use Illuminate\Support\Facades\DB;

/**
 * Tampering needs the triggers out of the way, and DDL commits implicitly in MySQL. So these tests leave the transaction
 * of RefreshDatabase, work on committed rows and restore the tables and triggers themselves.
 */
beforeEach(function () {
    DB::rollBack();

    Audit::record('one', after: ['value' => 1]);
    Audit::record('two', after: ['value' => 2]);
    Audit::record('three', after: ['value' => 3]);

    DB::unprepared('DROP TRIGGER IF EXISTS audit_events_no_update');
    DB::unprepared('DROP TRIGGER IF EXISTS audit_events_no_delete');

    $this->ids = DB::table('audit_events')->orderBy('id')->pluck('id')->all();
});

afterEach(function () {
    DB::unprepared('TRUNCATE TABLE audit_events');
    DB::table('audit_chain_head')->update(['last_event_id' => null, 'hash' => null, 'archived_through_id' => null, 'archived_hash' => null]);

    foreach (AuditChain::triggerStatements() as $statement) {
        DB::unprepared($statement);
    }
});

it('passes before anything was touched', function () {
    $this->artisan('audit:verify')->assertSuccessful();
});

it('detects a changed value', function () {
    DB::table('audit_events')->where('id', $this->ids[1])->update(['after' => '{"value":99}']);

    $this->artisan('audit:verify')->expectsOutputToContain("broken at event {$this->ids[1]}")->assertFailed();

    expect(cache('audit:last_verification'))->toMatchArray(['intact' => false, 'broken_at' => $this->ids[1], 'failure' => 'hash']);
});

it('detects a change in any hashed column', function (string $column, mixed $value) {
    DB::table('audit_events')->where('id', $this->ids[0])->update([$column => $value]);

    expect(AuditChain::verify())
        ->intact->toBeFalse()
        ->brokenAt->toBe($this->ids[0]);
})->with([
    'action' => ['action', 'other'],
    'actor' => ['actor_id', 'someone'],
    'target' => ['target_id', 'x'],
    'reason' => ['reason', 'cover-up'],
    'time' => ['occurred_at', '2020-01-01 00:00:00.000000'],
    'request id' => ['request_id', 'other'],
]);

it('detects a row rewritten with a fresh hash, at the next row', function () {
    $row = (array) DB::table('audit_events')->where('id', $this->ids[1])->first();
    $row['action'] = 'forged';
    $row['after'] = json_decode((string) $row['after'], true);

    DB::table('audit_events')->where('id', $this->ids[1])->update([
        'action' => 'forged',
        'hash' => AuditChain::hash($row['prev_hash'], $row),
    ]);

    expect(AuditChain::verify())
        ->intact->toBeFalse()
        ->brokenAt->toBe($this->ids[2])
        ->failure->toBe('prev_hash');
});

it('detects a deleted row in the middle', function () {
    DB::table('audit_events')->where('id', $this->ids[1])->delete();

    expect(AuditChain::verify())
        ->intact->toBeFalse()
        ->brokenAt->toBe($this->ids[2])
        ->failure->toBe('prev_hash');
});

it('detects a deleted first row', function () {
    DB::table('audit_events')->where('id', $this->ids[0])->delete();

    expect(AuditChain::verify())->intact->toBeFalse()->failure->toBe('prev_hash');
});

it('detects removed rows at the end through the head', function () {
    DB::table('audit_events')->where('id', $this->ids[2])->delete();

    expect(AuditChain::verify())->intact->toBeFalse()->failure->toBe('head');

    $this->artisan('audit:verify')->assertFailed();
});

it('detects an emptied table', function () {
    DB::table('audit_events')->delete();

    expect(AuditChain::verify())->intact->toBeFalse()->failure->toBe('head');
});

/**
 * Runs $action once, right after the first query that mentions $table.
 */
function afterFirstQueryOn(string $table, Closure $action): void
{
    $fired = false;

    DB::listen(function ($query) use (&$fired, $table, $action): void {
        if (! $fired && str_contains($query->sql, $table)) {
            $fired = true;
            $action();
        }
    });
}

it('stays intact when an event is written during the walk', function (string $table) {
    afterFirstQueryOn($table, fn () => Audit::record('during the walk'));

    expect(AuditChain::verify())
        ->intact->toBeTrue()
        ->checked->toBe(3);

    expect(DB::table('audit_events')->count())->toBe(4);
})->with([
    'after the head snapshot' => ['audit_chain_head'],
    'after the first page of events' => ['audit_events'],
]);

it('checks the new event on the next run', function () {
    afterFirstQueryOn('audit_chain_head', fn () => Audit::record('during the walk'));

    expect(AuditChain::verify()->checked)->toBe(3)
        ->and(AuditChain::verify())->intact->toBeTrue()->checked->toBe(4);
});

it('still detects a row added behind the back of the head', function () {
    $last = DB::table('audit_events')->where('id', $this->ids[2])->first();

    $forged = DB::table('audit_events')->insertGetId([
        'occurred_at' => $last->occurred_at,
        'actor_type' => 'system',
        'action' => 'forged',
        'prev_hash' => $last->hash,
        'hash' => str_repeat('a', 64),
    ]);

    expect(AuditChain::verify())
        ->intact->toBeFalse()
        ->brokenAt->toBe($forged)
        ->failure->toBe('head');
});

it('detects rows when the head was reset', function () {
    DB::table('audit_chain_head')->update(['last_event_id' => null, 'hash' => null]);

    expect(AuditChain::verify())
        ->intact->toBeFalse()
        ->brokenAt->toBe($this->ids[0])
        ->failure->toBe('head');
});

it('passes on an empty chain', function () {
    DB::table('audit_events')->delete();
    DB::table('audit_chain_head')->update(['last_event_id' => null, 'hash' => null]);

    expect(AuditChain::verify())->intact->toBeTrue()->checked->toBe(0);
});

it('passes when every event was archived and fails without a head row', function () {
    $last = DB::table('audit_events')->where('id', $this->ids[2])->first();
    DB::table('audit_events')->delete();
    DB::table('audit_chain_head')->update(['archived_through_id' => $this->ids[2], 'archived_hash' => $last->hash]);

    expect(AuditChain::verify())->intact->toBeTrue()->checked->toBe(0);

    DB::table('audit_chain_head')->delete();

    expect(AuditChain::verify())->intact->toBeFalse()->failure->toBe('head');

    DB::table('audit_chain_head')->insert(['id' => 1]);
});

it('restarts once when archiving overtakes the walk', function () {
    $first = DB::table('audit_events')->where('id', $this->ids[0])->first();

    afterFirstQueryOn('audit_chain_head', function () use ($first): void {
        DB::table('audit_events')->where('id', $first->id)->delete();
        DB::table('audit_chain_head')->update(['archived_through_id' => $first->id, 'archived_hash' => $first->hash]);
    });

    expect(AuditChain::verify())->intact->toBeTrue()->checked->toBe(2);
});
