<?php

use App\Enums\ApprovalEvent;
use App\Enums\ApprovalStatus;
use App\Enums\CaseStatus;
use App\Enums\StaffStatus;
use App\Enums\UserStatus;
use App\Models\ApprovalRequest;
use App\Models\AuditEvent;
use App\Models\Decision;
use App\Models\ModerationCase;
use App\Models\Staff;
use App\Services\Approvals\ApprovalConflict;
use App\Services\Approvals\ApprovalHandler;
use App\Services\Approvals\Approvals;
use App\Services\Approvals\HandlerRegistry;
use App\Services\Audit\Audit;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Events\QueryExecuted;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

require_once dirname(__DIR__, 2).'/Feature/Staff/Helpers.php';

uses(RefreshDatabase::class);

/**
 * The four-eyes engine (ADR-214): every rule of App\Services\Approvals, with a recording test handler for the generic rules and the
 * real moderation.suspend handler for the execution path.
 */
final class M31RecordingHandler implements ApprovalHandler
{
    public int $executions = 0;

    public bool $ownerOnly = false;

    public bool $refuse = false;

    public function key(): string
    {
        return 'test.record';
    }

    public function atom(): string
    {
        return 'members.edit';
    }

    public function requiresOwner(array $payload): bool
    {
        return $this->ownerOnly;
    }

    public function validate(array $payload): void
    {
        Validator::make($payload, ['value' => ['required', 'string']])->validate();

        if ($this->refuse) {
            throw ValidationException::withMessages(['value' => ['The world changed.']]);
        }
    }

    public function describe(array $payload): array
    {
        return ['title' => 'approvals.test.title', 'subject_label' => null, 'lines' => [['label' => 'approvals.test.value', 'after' => (string) $payload['value']]]];
    }

    public function execute(ApprovalRequest $request, Staff $approver): array
    {
        $this->executions++;
        Audit::record('test.recorded', $request, after: ['requested_by' => $request->requested_by, 'approved_by' => $approver->id], actor: $approver);

        return ['value' => $request->payload['value']];
    }
}

function m31Handler(): M31RecordingHandler
{
    $handler = new M31RecordingHandler;
    app(HandlerRegistry::class)->add($handler);

    return $handler;
}

function m31Approvals(): Approvals
{
    return app(Approvals::class);
}

function m31Ask(Staff $by, array $payload = ['value' => 'x'], ?Model $subject = null): ApprovalRequest
{
    return m31Approvals()->request('test.record', $payload, 'Weil der Fall es verlangt.', $by, $subject);
}

function m31SuspendPayload(ModerationCase $case, array $overrides = []): array
{
    return [
        'case_id' => $case->id,
        'facts' => 'Wiederholte Beleidigungen in Nachrichten an drei Mitglieder.',
        'ground' => 'Community-Richtlinien, respektvoller Umgang',
        'ground_document' => 'community',
        'ground_section' => '§ 3',
        'until' => now()->addDays(14)->toIso8601String(),
        ...$overrides,
    ];
}

beforeEach(function () {
    $this->handler = m31Handler();
});

describe('Approvals::request', function () {
    it('creates a pending request that expires in 24 hours, audited with its reason', function () {
        $admin = m31Staff('admin');

        $request = m31Ask($admin);

        expect($request->status)->toBe(ApprovalStatus::Pending)
            ->and($request->expires_at->diffInMinutes(now()->addDay(), true))->toBeLessThan(1)
            ->and($request->summary['title'])->toBe('approvals.test.title')
            ->and($request->payload)->toBe(['value' => 'x'])
            ->and(DB::table('approval_requests')->value('payload'))->not->toContain('"x"')
            ->and($this->handler->executions)->toBe(0);

        $event = AuditEvent::query()->sole();
        expect($event->action)->toBe(ApprovalEvent::Requested->value)
            ->and($event->reason)->toBe('Weil der Fall es verlangt.')
            ->and($event->actor_id)->toBe((string) $admin->id);
    });

    it('needs the action\'s atom from the requester', function () {
        expect(fn () => m31Ask(m31Staff('analyst')))->toThrow(AuthorizationException::class);
        expect(ApprovalRequest::query()->count())->toBe(0);
    });

    it('needs an active requester', function () {
        expect(fn () => m31Ask(m31Staff('admin', attributes: ['status' => StaffStatus::Suspended])))->toThrow(AuthorizationException::class);
    });

    it('needs a reason of 10 to 1000 characters', function (string $reason) {
        expect(fn () => m31Approvals()->request('test.record', ['value' => 'x'], $reason, m31Staff('admin')))->toThrow(ValidationException::class);
    })->with(['short' => 'zu kurz', 'blank' => '          ', 'long' => str_repeat('a', 1001)]);

    it('validates the payload before asking', function () {
        expect(fn () => m31Ask(m31Staff('admin'), []))->toThrow(ValidationException::class);
    });

    it('keeps one pending request per action and subject, and answers the existing one', function () {
        $case = ModerationCase::factory()->create();
        $first = m31Ask(m31Staff('admin'), ['value' => 'a'], $case);
        $second = m31Ask(m31Staff('admin'), ['value' => 'b'], $case);

        expect($second->id)->toBe($first->id)
            ->and(ApprovalRequest::query()->count())->toBe(1)
            ->and(m31Ask(m31Staff('admin'), ['value' => 'c'], ModerationCase::factory()->create())->id)->not->toBe($first->id);
    });

    it('replaces an expired pending request with a new one', function () {
        $case = ModerationCase::factory()->create();
        $first = m31Ask(m31Staff('admin'), ['value' => 'a'], $case);
        $this->travel(25)->hours();

        $second = m31Ask(m31Staff('admin'), ['value' => 'b'], $case);

        expect($second->id)->not->toBe($first->id)
            ->and($first->fresh()?->status)->toBe(ApprovalStatus::Expired);
    });
});

describe('Approvals::approve', function () {
    it('executes on the approval of a second staff member, both steps audited, the action\'s event naming both', function () {
        $requester = m31Staff('admin');
        $approver = m31Staff('owner');
        $request = m31Ask($requester);

        $done = m31Approvals()->approve($request, $approver, 'Passt so.');

        expect($done->status)->toBe(ApprovalStatus::Executed)
            ->and($done->decided_by)->toBe($approver->id)
            ->and($done->executed_at)->not->toBeNull()
            ->and($done->result)->toBe(['value' => 'x'])
            ->and($done->decision_comment)->toBe('Passt so.')
            ->and($this->handler->executions)->toBe(1)
            ->and(AuditEvent::query()->orderBy('id')->pluck('action')->all())->toBe([ApprovalEvent::Requested->value, 'test.recorded', ApprovalEvent::Approved->value]);

        $own = AuditEvent::query()->where('action', 'test.recorded')->sole();
        expect($own->after)->toEqualCanonicalizing(['requested_by' => $requester->id, 'approved_by' => $approver->id]);
    });

    it('never lets the requester approve', function () {
        $owner = m31Staff('owner');
        $request = m31Ask($owner);

        expect(fn () => m31Approvals()->approve($request, $owner))->toThrow(AuthorizationException::class);
        expect($request->fresh()?->status)->toBe(ApprovalStatus::Pending)->and($this->handler->executions)->toBe(0);
    });

    it('needs approvals.decide and the action\'s atom from the approver', function (string $role) {
        $request = m31Ask(m31Staff('admin'));

        expect(fn () => m31Approvals()->approve($request, m31Staff($role)))->toThrow(AuthorizationException::class);
        expect($this->handler->executions)->toBe(0);
    })->with(['moderator', 'support', 'content_editor', 'analyst']);

    it('refuses an approver who holds approvals.decide but not the atom', function () {
        $approver = m31Staff();
        $approver->givePermissionTo('approvals.decide');
        $request = m31Ask(m31Staff('admin'));

        expect(fn () => m31Approvals()->approve($request, $approver->fresh() ?? $approver))->toThrow(AuthorizationException::class);
    });

    it('refuses a suspended approver', function () {
        $request = m31Ask(m31Staff('admin'));

        expect(fn () => m31Approvals()->approve($request, m31Staff('owner', attributes: ['status' => StaffStatus::Suspended])))->toThrow(AuthorizationException::class);
    });

    it('leaves Owner-only actions to an Owner', function () {
        $this->handler->ownerOnly = true;
        $request = m31Ask(m31Staff('admin'));

        expect(fn () => m31Approvals()->approve($request, m31Staff('admin')))->toThrow(AuthorizationException::class);
        expect(m31Approvals()->approve($request, m31Staff('owner'))->status)->toBe(ApprovalStatus::Executed);
    });

    it('expires instead of executing after 24 hours', function () {
        $request = m31Ask(m31Staff('admin'));
        $this->travelTo(now()->addHours(24)->addSecond());

        $done = m31Approvals()->approve($request, m31Staff('owner'));

        expect($done->status)->toBe(ApprovalStatus::Expired)
            ->and($this->handler->executions)->toBe(0)
            ->and(AuditEvent::query()->where('action', ApprovalEvent::Expired->value)->count())->toBe(1);
    });

    it('fails without executing when the re-validation refuses, audited', function () {
        $request = m31Ask(m31Staff('admin'));
        $this->handler->refuse = true;

        $done = m31Approvals()->approve($request, m31Staff('owner'));

        expect($done->status)->toBe(ApprovalStatus::Failed)
            ->and($done->result)->toBe(['error' => 'The world changed.'])
            ->and($this->handler->executions)->toBe(0)
            ->and(AuditEvent::query()->where('action', ApprovalEvent::Failed->value)->count())->toBe(1);
    });

    it('fails when the requester lost the atom in the meantime', function () {
        $requester = m31Staff('admin');
        $request = m31Ask($requester);
        $requester->syncRoles(['analyst']);

        expect(m31Approvals()->approve($request, m31Staff('owner'))->status)->toBe(ApprovalStatus::Failed)
            ->and($this->handler->executions)->toBe(0);
    });

    it('executes once: the second approval finds it decided, under the row lock', function () {
        $request = m31Ask(m31Staff('admin'));
        $locks = 0;
        DB::listen(function (QueryExecuted $query) use (&$locks): void {
            if (str_contains($query->sql, 'from `approval_requests`') && str_contains($query->sql, 'for update')) {
                $locks++;
            }
        });

        m31Approvals()->approve($request, m31Staff('owner'));

        expect(fn () => m31Approvals()->approve($request, m31Staff('owner')))->toThrow(ApprovalConflict::class);
        expect($this->handler->executions)->toBe(1)->and($locks)->toBe(2);
    });
});

describe('Approvals::deny, cancel, pendingFor and expire', function () {
    it('denies with a comment, by someone who may approve', function () {
        $request = m31Ask(m31Staff('admin'));

        expect(fn () => m31Approvals()->deny($request, m31Staff('owner'), ''))->toThrow(ValidationException::class);
        expect(fn () => m31Approvals()->deny($request, m31Staff('analyst'), 'Nicht zuständig.'))->toThrow(AuthorizationException::class);

        $done = m31Approvals()->deny($request, m31Staff('owner'), 'Nicht nötig.');

        expect($done->status)->toBe(ApprovalStatus::Denied)
            ->and($done->decision_comment)->toBe('Nicht nötig.')
            ->and($this->handler->executions)->toBe(0)
            ->and(AuditEvent::query()->where('action', ApprovalEvent::Denied->value)->sole()->reason)->toBe('Nicht nötig.');
    });

    it('lets only the requester cancel', function () {
        $requester = m31Staff('admin');
        $request = m31Ask($requester);

        expect(fn () => m31Approvals()->cancel($request, m31Staff('owner')))->toThrow(AuthorizationException::class);

        expect(m31Approvals()->cancel($request, $requester)->status)->toBe(ApprovalStatus::Cancelled)
            ->and(AuditEvent::query()->where('action', ApprovalEvent::Cancelled->value)->count())->toBe(1);
        expect(fn () => m31Approvals()->approve($request, m31Staff('owner')))->toThrow(ApprovalConflict::class);
    });

    it('lists what a staff member may approve: others\' requests, within their atoms, not expired', function () {
        $admin = m31Staff('admin');
        $owner = m31Staff('owner');
        $mine = m31Ask($owner, ['value' => 'mine']);
        $theirs = m31Ask($admin, ['value' => 'theirs']);
        ApprovalRequest::factory()->expired()->create(['action' => 'test.record', 'requested_by' => $admin->id]);

        expect(m31Approvals()->pendingFor($owner)->pluck('id')->all())->toBe([$theirs->id])
            ->and(m31Approvals()->pendingFor($admin)->pluck('id')->all())->toBe([$mine->id])
            ->and(m31Approvals()->pendingFor(m31Staff('moderator'))->all())->toBe([]);

        $this->handler->ownerOnly = true;
        expect(m31Approvals()->pendingFor(m31Staff('admin'))->all())->toBe([]);
    });

    it('expires pending requests hourly through approvals:expire, audited as the system', function () {
        $request = m31Ask(m31Staff('admin'));
        $this->travel(25)->hours();

        $this->artisan('approvals:expire')->assertSuccessful();

        expect($request->fresh()?->status)->toBe(ApprovalStatus::Expired)
            ->and(AuditEvent::query()->where('action', ApprovalEvent::Expired->value)->sole()->actor_type->value)->toBe('system');
    });

    it('discovers the handlers of the directory', function () {
        expect(array_keys(app(HandlerRegistry::class)->all()))->toContain('audit.export', 'moderation.suspend');
    });
});

describe('moderation.suspend (ADR-206, SEC-P2-10)', function () {
    it('suspends the member on approval, with the requester as decider and the approver recorded', function () {
        $case = ModerationCase::factory()->create();
        $moderator = m31Staff('moderator');
        $admin = m31Staff('admin');

        $request = m31Approvals()->request('moderation.suspend', m31SuspendPayload($case), 'Mehrere Meldungen, eindeutige Belege.', $moderator, $case);
        $done = m31Approvals()->approve($request, $admin);

        $decision = Decision::query()->sole();

        expect($done->status)->toBe(ApprovalStatus::Executed)
            ->and($done->result)->toBe(['decision_id' => $decision->id, 'case_id' => $case->id])
            ->and($decision->decided_by)->toBe($moderator->id)
            ->and($case->subject?->fresh()?->status)->toBe(UserStatus::Suspended);

        $event = AuditEvent::query()->where('action', 'moderation.decided')->sole();
        expect($event->actor_id)->toBe((string) $moderator->id)
            ->and($event->after['approved_by'])->toBe($admin->id)
            ->and(AuditEvent::query()->orderByDesc('id')->value('action'))->toBe(ApprovalEvent::Approved->value);
    });

    it('describes the request for the queue without personal data beyond the username', function () {
        $case = ModerationCase::factory()->create();

        $request = m31Approvals()->request('moderation.suspend', m31SuspendPayload($case), 'Mehrere Meldungen, eindeutige Belege.', m31Staff('moderator'), $case);

        expect($request->summary['title'])->toBe('approvals.moderation_suspend.title')
            ->and($request->summary['subject_label'])->toBe('@'.$case->subject?->username)
            ->and((string) json_encode($request->summary))->not->toContain((string) $case->subject?->email);
    });

    it('fails when the case was decided before the approval', function () {
        $case = ModerationCase::factory()->create();
        $request = m31Approvals()->request('moderation.suspend', m31SuspendPayload($case), 'Mehrere Meldungen, eindeutige Belege.', m31Staff('moderator'), $case);
        $case->forceFill(['status' => CaseStatus::Decided, 'open_target' => null])->save();

        $done = m31Approvals()->approve($request, m31Staff('admin'));

        expect($done->status)->toBe(ApprovalStatus::Failed)
            ->and(Decision::query()->count())->toBe(0)
            ->and($case->subject?->fresh()?->status)->not->toBe(UserStatus::Suspended);
    });

    it('refuses a malformed payload at the request', function () {
        $case = ModerationCase::factory()->create();

        expect(fn () => m31Approvals()->request('moderation.suspend', m31SuspendPayload($case, ['until' => now()->subDay()->toIso8601String()]), 'Mehrere Meldungen, eindeutige Belege.', m31Staff('moderator'), $case))
            ->toThrow(ValidationException::class);
    });
});

describe('review N-1 and N-2', function () {
    it('tells a fresh request from one that was already pending (wasRecentlyCreated)', function () {
        m31Handler();
        $subject = m31Staff();
        $first = m31Ask(m31Staff('admin'), subject: $subject);
        $again = m31Ask(m31Staff('admin'), ['value' => 'other'], $subject);

        expect($first->wasRecentlyCreated)->toBeTrue()
            ->and($again->wasRecentlyCreated)->toBeFalse()
            ->and($again->id)->toBe($first->id);
    });

    it('counts what pendingFor lists, without the 200-row cap and with the payload atoms', function () {
        m31Handler();
        $owner = m31Staff('owner');
        $admin = m31Staff('admin');

        foreach (range(1, 3) as $n) {
            m31Ask($admin, ['value' => "v$n"]);
        }
        m31Ask($owner, ['value' => 'mine']);
        // members.bulk decides by payload: a revoke_sessions bulk needs members.revoke_sessions, which support holds and moderators lack.
        m31Approvals()->request('members.bulk', ['action' => 'revoke_sessions', 'ids' => [strtolower((string) Str::ulid())], 'options' => []], 'Weil der Fall es verlangt.', m31Staff('support'));

        foreach ([$owner, $admin, m31Staff('admin'), m31Staff('moderator'), m31Staff('analyst')] as $staff) {
            expect(m31Approvals()->countFor($staff))->toBe(m31Approvals()->pendingFor($staff)->count());
        }

        expect(m31Approvals()->countFor($owner))->toBe(4)
            ->and(m31Approvals()->countFor($admin))->toBe(2);
    });
});
