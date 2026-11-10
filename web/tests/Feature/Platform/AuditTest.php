<?php

use App\Enums\AuditActorType;
use App\Models\AuditEvent;
use App\Models\Staff;
use App\Models\User;
use App\Services\Audit\Audit;
use App\Services\Audit\AuditChain;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;

it('writes the row and links it to the previous one', function () {
    $user = User::factory()->create();

    Audit::record('member.restricted', $user, ['status' => 'active'], ['status' => 'restricted'], 'Spam');
    Audit::record('member.unrestricted', $user);

    [$first, $second] = AuditEvent::query()->orderBy('id')->get();

    expect($first->action)->toBe('member.restricted')
        ->and($first->target_type)->toBe('user')
        ->and($first->target_id)->toBe($user->id)
        ->and($first->before)->toBe(['status' => 'active'])
        ->and($first->after)->toBe(['status' => 'restricted'])
        ->and($first->reason)->toBe('Spam')
        ->and($first->prev_hash)->toBeNull()
        ->and($first->hash)->toMatch('/^[0-9a-f]{64}$/')
        ->and($first->occurred_at)->not->toBeNull()
        ->and($second->prev_hash)->toBe($first->hash)
        ->and($second->hash)->not->toBe($first->hash);
});

it('hashes the previous hash with the canonical row', function () {
    Audit::record('a', after: ['b' => 1, 'a' => ['y' => 2, 'x' => 'ä/ö']]);

    $row = (array) DB::table('audit_events')->first();
    $row['after'] = json_decode($row['after'], true);

    expect($row['hash'])->toBe(AuditChain::hash(null, $row))
        ->and(AuditChain::canonicalJson($row['after']))->toBe('{"a":{"x":"ä/ö","y":2},"b":1}');
});

it('canonical JSON does not depend on key order', function () {
    expect(AuditChain::canonicalJson(['b' => 1, 'a' => 2]))->toBe(AuditChain::canonicalJson(['a' => 2, 'b' => 1]))
        ->and(AuditChain::canonicalJson([3, 1]))->toBe('[3,1]')
        ->and(AuditChain::canonicalJson(['a' => 1.0]))->toBe('{"a":1.0}');
});

it('records the IP and user agent of staff', function () {
    $staff = Staff::factory()->create();

    $this->withServerVariables(['REMOTE_ADDR' => '203.0.113.9']);
    request()->server->set('REMOTE_ADDR', '203.0.113.9');
    request()->headers->set('User-Agent', 'Staff Browser');

    Audit::record('role.changed', actor: $staff);

    $event = AuditEvent::query()->sole();
    $access = DB::table('audit_event_access')->where('audit_event_id', $event->id)->sole();

    expect($event->actor_type)->toBe(AuditActorType::Staff)
        ->and($event->actor_id)->toBe((string) $staff->id)
        ->and($access->ip)->toBe('203.0.113.9')
        ->and($access->user_agent)->toBe('Staff Browser');
});

it('never stores the IP or user agent of members', function () {
    $member = User::factory()->create();
    request()->server->set('REMOTE_ADDR', '203.0.113.9');
    request()->headers->set('User-Agent', 'Member Phone');

    Audit::record('password.changed', actor: $member);

    $event = AuditEvent::query()->sole();

    expect($event->actor_type)->toBe(AuditActorType::Member)
        ->and($event->actor_id)->toBe($member->id)
        ->and(DB::table('audit_event_access')->count())->toBe(0);
});

it('takes the signed-in user as actor and falls back to the system', function () {
    Audit::record('system.job');
    expect(AuditEvent::query()->sole()->actor_type)->toBe(AuditActorType::System);

    $member = User::factory()->create();
    Auth::setUser($member);

    Audit::record('member.action');
    expect(AuditEvent::query()->orderByDesc('id')->first()->actor_id)->toBe($member->id);
});

it('redacts secrets at any depth', function () {
    Audit::record('x', after: [
        'password' => 'hunter2hunter2',
        'nested' => ['remember_token' => 'abc', 'two_factor_secret' => 'def', 'keep' => 'visible'],
        'api_secret' => 'ghi',
    ]);

    $raw = (string) DB::table('audit_events')->value('after');

    expect($raw)->not->toContain('hunter2')->not->toContain('abc')->not->toContain('def')->not->toContain('ghi')
        ->and($raw)->toContain('visible');
});

it('resolves enums and dates in before and after', function () {
    Audit::record('x', after: ['actor' => AuditActorType::Staff, 'at' => now()]);

    expect(AuditEvent::query()->sole()->after['actor'])->toBe('staff');
});

it('cuts over-long values to fit the columns and still verifies', function () {
    Audit::record(str_repeat('a', 200), reason: str_repeat('ä', 1500));

    $event = AuditEvent::query()->sole();

    expect(mb_strlen($event->action))->toBe(100)
        ->and(mb_strlen($event->reason))->toBe(1000);

    $this->artisan('audit:verify')->assertSuccessful();
});

it('is rolled back with the transaction of the caller and leaves no gap in the chain', function () {
    Audit::record('first');

    try {
        DB::transaction(function () {
            Audit::record('rolled back');

            throw new RuntimeException('oops');
        });
    } catch (RuntimeException) {
    }

    Audit::record('second');

    expect(AuditEvent::query()->pluck('action')->all())->toBe(['first', 'second']);

    $this->artisan('audit:verify')->assertSuccessful();
});

it('has no update or delete path in the model', function () {
    Audit::record('x');
    $event = AuditEvent::query()->sole();

    expect(fn () => $event->update(['action' => 'changed']))->toThrow(LogicException::class)
        ->and(fn () => $event->delete())->toThrow(LogicException::class);
});

it('rejects UPDATE and DELETE in the database', function () {
    Audit::record('x');

    expect(fn () => DB::table('audit_events')->update(['action' => 'changed']))->toThrow(QueryException::class, 'append-only')
        ->and(fn () => DB::table('audit_events')->delete())->toThrow(QueryException::class, 'append-only');
});

it('verifies an empty and an intact chain', function () {
    $this->artisan('audit:verify')->expectsOutputToContain('0 events')->assertSuccessful();

    Audit::record('a', after: ['float' => 1.5, 'list' => [1, 2], 'empty' => [], 'text' => 'Größe "quoted"']);
    Audit::record('b', User::factory()->create());
    Audit::record('c');

    $this->artisan('audit:verify')->expectsOutputToContain('3 events')->assertSuccessful();

    expect(cache('audit:last_verification'))->toMatchArray(['intact' => true, 'checked' => 3]);
});

it('exports one day as JSONL to private storage', function () {
    Storage::fake('local');
    Audit::record('today', after: ['a' => 'ä']);

    $this->artisan('audit:export', ['--date' => now()->format('Y-m-d')])->assertSuccessful();

    $line = json_decode(trim(Storage::disk('local')->get('audit/'.now()->format('Y-m-d').'.jsonl')), true);

    expect($line['action'])->toBe('today')
        ->and($line['hash'])->toMatch('/^[0-9a-f]{64}$/');

    $this->artisan('audit:export', ['--date' => now()->subDays(3)->format('Y-m-d')])->assertSuccessful();

    expect(Storage::disk('local')->get('audit/'.now()->subDays(3)->format('Y-m-d').'.jsonl'))->toBe('');
});

it('has no column that changes by itself on update', function () {
    $columns = DB::table('information_schema.columns')
        ->where('table_schema', DB::connection()->getDatabaseName())
        ->where('extra', 'like', '%on update%')
        ->where('table_name', '!=', 'health_check_result_history_items')
        ->get(['table_name', 'column_name']);

    expect($columns)->toBeEmpty();
});
