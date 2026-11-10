<?php

use App\Actions\Admin\Members\BulkMemberAction;
use App\Actions\Admin\Members\DeleteMemberAsStaff;
use App\Actions\Admin\Members\ExportMemberData;
use App\Actions\Admin\Members\RequestMemberDeletion;
use App\Actions\Admin\Members\RequestMemberExport;
use App\Actions\Admin\Members\RequestMemberSuspension;
use App\Actions\Admin\Members\RequestTwoFactorReset;
use App\Actions\Admin\Members\ResetMemberTwoFactor;
use App\Actions\Admin\Vehicles\BulkHideVehicles;
use App\Actions\Admin\Vehicles\DeleteVehicleAsStaff;
use App\Actions\Garage\DeleteVehicle;
use App\Actions\Moderation\DecideCase;
use App\Enums\ApprovalStatus;
use App\Enums\DecisionAction;
use App\Enums\GroundDocument;
use App\Enums\UserStatus;
use App\Enums\Visibility;
use App\Models\ApprovalRequest;
use App\Models\AuditEvent;
use App\Models\DataExport;
use App\Models\Decision;
use App\Models\ModerationCase;
use App\Models\Staff;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\Admin\Members\BulkRunner;
use App\Services\Approvals\ApprovalConflict;
use App\Services\Approvals\ApprovalHandler;
use App\Services\Approvals\Approvals;
use App\Services\Approvals\HandlerRegistry;
use App\Services\Approvals\RunsRecordByRecord;
use App\Services\Moderation\DecisionInput;
use App\Services\Moderation\OwnInitiativeCases;
use Database\Seeders\StaffSeeder;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Storage;

require_once __DIR__.'/Helpers.php';

/**
 * Code review MF-1 / SEC-P3-10: the four-eyes executors run only while Approvals::approve() executes their own request; SF-3 / SEC-P3-09:
 * bulk approvals run record by record after the approval committed; SF-4 / SEC-P3-08: the 100-record threshold over a rolling 24 hours,
 * and summaries that name the records.
 */
beforeEach(function () {
    $this->withoutDefer();
    Mail::fake();
    $this->member = User::factory()->create(['username' => 'mia.rs3', 'locale' => 'de']);
    $this->requester = m31Staff('admin');
    $this->approver = m31Staff('owner');
});

/** A handler test double, registered for one key. */
function m33Handler(string $key, Closure $execute, bool $stepwise = false): ApprovalHandler
{
    $handler = $stepwise
        ? new class($key, $execute) implements ApprovalHandler, RunsRecordByRecord
        {
            use M33FakeHandler;
        }
    : new class($key, $execute) implements ApprovalHandler
    {
        use M33FakeHandler;
    };

    app(HandlerRegistry::class)->add($handler);

    return $handler;
}

trait M33FakeHandler
{
    public function __construct(private string $name, private Closure $run) {}

    public function key(): string
    {
        return $this->name;
    }

    public function atom(): string
    {
        return 'members.view';
    }

    public function requiresOwner(array $payload): bool
    {
        return false;
    }

    public function validate(array $payload): void {}

    public function describe(array $payload): array
    {
        return ['title' => 'approvals.test.title', 'subject_label' => null, 'lines' => []];
    }

    public function execute(ApprovalRequest $request, Staff $approver): array
    {
        return ($this->run)($request, $approver);
    }
}

describe('MF-1: executors refuse a direct call with two valid staff members', function () {
    it('ResetMemberTwoFactor', function () {
        $this->member->forceFill(['two_factor_secret' => str_repeat('A', 32), 'two_factor_confirmed_at' => now(), 'two_factor_recovery_codes' => ['x']])->save();

        expect(fn () => app(ResetMemberTwoFactor::class)->handle($this->requester, $this->approver, $this->member, m32Reason()))->toThrow(AuthorizationException::class)
            ->and($this->member->refresh()->hasTwoFactor())->toBeTrue()
            ->and(AuditEvent::query()->where('action', 'member.two_factor_reset')->count())->toBe(0);
    });

    it('DeleteMemberAsStaff', function () {
        expect(fn () => app(DeleteMemberAsStaff::class)->handle($this->requester, $this->approver, $this->member, m32Reason()))->toThrow(AuthorizationException::class)
            ->and($this->member->refresh()->status)->toBe(UserStatus::Active);
    });

    it('ExportMemberData', function () {
        expect(fn () => app(ExportMemberData::class)->handle($this->requester, $this->approver, $this->member, m32Reason()))->toThrow(AuthorizationException::class)
            ->and(DataExport::query()->count())->toBe(0);
    });

    it('BulkMemberAction::execute', function () {
        $this->member->createToken('phone', ['member']);

        expect(fn () => app(BulkMemberAction::class)->execute($this->requester, $this->approver, 'revoke_sessions', [$this->member->id], m32Reason(), []))->toThrow(AuthorizationException::class)
            ->and(fn () => app(BulkMemberAction::class)->execute($this->requester, $this->approver, 'delete', [$this->member->id], m32Reason(), []))->toThrow(AuthorizationException::class)
            ->and($this->member->tokens()->count())->toBe(1)
            ->and($this->member->refresh()->status)->toBe(UserStatus::Active);
    });

    it('BulkHideVehicles::execute', function () {
        $vehicle = modVehicle($this->member);

        expect(fn () => app(BulkHideVehicles::class)->execute($this->requester, $this->approver, [$vehicle->id], m32Statement(), m32Reason()))->toThrow(AuthorizationException::class)
            ->and($vehicle->refresh()->visibility)->toBe(Visibility::Public);
    });

    it('DecideCase for a staff suspension, even with a second staff member named as approver', function () {
        $case = app(OwnInitiativeCases::class)->forTarget($this->member, $this->requester);

        expect(fn () => app(DecideCase::class)->handle($case, new DecisionInput(
            action: DecisionAction::Suspend,
            facts: 'Wiederholte Drohungen gegen andere Mitglieder.',
            ground: 'Community-Richtlinien §2',
            groundDocument: GroundDocument::Community,
            decidedBy: $this->requester,
            reason: m32Reason(),
            approvedBy: $this->approver,
        )))->toThrow(AuthorizationException::class)
            ->and($this->member->refresh()->status)->toBe(UserStatus::Active)
            ->and(Decision::query()->count())->toBe(0);
    });

    it('every approval handler, given a real pending request and a valid approver', function (string $action, Closure $ask) {
        $request = $ask($this);
        expect($request->status)->toBe(ApprovalStatus::Pending);

        expect(fn () => app(HandlerRegistry::class)->get($action)->execute($request, $this->approver))->toThrow(AuthorizationException::class)
            ->and($request->refresh()->status)->toBe(ApprovalStatus::Pending)
            ->and($this->member->refresh()->status)->toBe(UserStatus::Active)
            ->and(DataExport::query()->count())->toBe(0);
    })->with([
        'members.delete' => ['members.delete', fn ($test) => app(RequestMemberDeletion::class)->handle($test->requester, $test->member, m32Reason())],
        'members.export' => ['members.export', fn ($test) => app(RequestMemberExport::class)->handle($test->requester, $test->member, m32Reason())],
        'members.reset_2fa' => ['members.reset_2fa', function ($test) {
            $test->member->forceFill(['two_factor_secret' => str_repeat('A', 32), 'two_factor_confirmed_at' => now(), 'two_factor_recovery_codes' => ['x']])->save();

            return app(RequestTwoFactorReset::class)->handle($test->requester, $test->member, m32Reason());
        }],
        'moderation.suspend' => ['moderation.suspend', fn ($test) => app(RequestMemberSuspension::class)->handle($test->requester, $test->member, null, m32Statement(), m32Reason())],
        'members.bulk' => ['members.bulk', fn ($test) => app(BulkMemberAction::class)->handle($test->requester, 'delete', [$test->member->id], m32Reason())->approval],
        'vehicles.bulk_hide' => ['vehicles.bulk_hide', fn ($test) => app(BulkHideVehicles::class)->handle($test->requester, Vehicle::factory()->published()->count(101)->create()->pluck('id')->all(), m32Statement(), m32Reason())->approval],
        'audit.export' => ['audit.export', fn ($test) => app(Approvals::class)->request('audit.export', ['format' => 'csv', 'filter' => []], m32Reason(), $test->requester)],
        'members.list_export' => ['members.list_export', fn ($test) => app(Approvals::class)->request('members.list_export', ['filter' => [], 'sort' => null, 'rows_at_request' => 1], m32Reason(), $test->requester)],
    ]);

    it('refuses an executor run inside another action\'s approval', function () {
        $this->member->forceFill(['two_factor_secret' => str_repeat('A', 32), 'two_factor_confirmed_at' => now(), 'two_factor_recovery_codes' => ['x']])->save();
        m33Handler('test.smuggle', function (ApprovalRequest $request, Staff $approver): array {
            $requester = Staff::query()->findOrFail($request->requested_by);
            app(ResetMemberTwoFactor::class)->handle($requester, $approver, test()->member, m32Reason());

            return [];
        });

        $request = app(Approvals::class)->request('test.smuggle', [], m32Reason(), $this->requester);

        expect(fn () => m32Approve($request, $this->approver))->toThrow(AuthorizationException::class)
            ->and($this->member->refresh()->hasTwoFactor())->toBeTrue()
            ->and($request->refresh()->status)->toBe(ApprovalStatus::Pending);
    });

    it('refuses an executor inside its own approval for another member or with someone else as approver', function () {
        $other = User::factory()->create();
        $third = m31Staff('admin');
        m33Handler('members.delete', function (ApprovalRequest $request, Staff $approver) use ($other, $third): array {
            $requester = Staff::query()->findOrFail($request->requested_by);

            expect(fn () => app(DeleteMemberAsStaff::class)->handle($requester, $approver, $other, m32Reason()))->toThrow(AuthorizationException::class)
                ->and(fn () => app(DeleteMemberAsStaff::class)->handle($requester, $third, test()->member, m32Reason()))->toThrow(AuthorizationException::class)
                ->and(fn () => app(DeleteMemberAsStaff::class)->handle($third, $approver, test()->member, m32Reason()))->toThrow(AuthorizationException::class);

            // The one call that matches the request runs.
            app(DeleteMemberAsStaff::class)->handle($requester, $approver, test()->member, m32Reason());

            return [];
        });

        $done = m32Approve(app(Approvals::class)->request('members.delete', ['member_id' => $this->member->id], m32Reason(), $this->requester, $this->member), $this->approver);

        expect($done->status)->toBe(ApprovalStatus::Executed)
            ->and($other->refresh()->status)->toBe(UserStatus::Active)
            ->and($this->member->refresh()->status)->toBe(UserStatus::Deactivated);
    });

    it('clears the executing request after approve(), also when the handler throws', function () {
        m33Handler('test.boom', fn (): array => throw new RuntimeException('boom'));

        expect(fn () => m32Approve(app(Approvals::class)->request('test.boom', [], m32Reason(), $this->requester), $this->approver))->toThrow(RuntimeException::class)
            ->and(Approvals::executing())->toBeNull();
    });
});

describe('SF-3: a bulk approval runs record by record after the approval committed', function () {
    it('runs a RunsRecordByRecord handler outside the approval transaction, as executing, and ends executed', function () {
        $seen = [];
        m33Handler('test.inline', function (ApprovalRequest $request) use (&$seen): array {
            $seen['inline'] = DB::transactionLevel();

            return [];
        });
        m33Handler('test.stepwise', function (ApprovalRequest $request) use (&$seen): array {
            $seen['stepwise'] = DB::transactionLevel();
            $seen['status'] = ApprovalRequest::query()->whereKey($request->id)->value('status');

            return ['done' => 1];
        }, stepwise: true);

        $base = DB::transactionLevel();
        m32Approve(app(Approvals::class)->request('test.inline', [], m32Reason(), $this->requester), $this->approver);
        $done = m32Approve(app(Approvals::class)->request('test.stepwise', [], m32Reason(), $this->requester), $this->approver);

        expect($seen['inline'])->toBe($base + 2)
            ->and($seen['stepwise'])->toBe($base)
            ->and($seen['status'])->toBe(ApprovalStatus::Executing)
            ->and($done->status)->toBe(ApprovalStatus::Executed)
            ->and($done->result)->toBe(['done' => 1])
            ->and($done->decided_by)->toBe($this->approver->id)
            ->and(AuditEvent::query()->where('action', 'approval.approved')->count())->toBe(2);
    });

    it('keeps every record that ran when another one fails, and a second approve of an executing request is a conflict', function () {
        $ids = User::factory()->count(101)->create()->pluck('id')->all();
        foreach ($ids as $id) {
            User::query()->findOrFail($id)->createToken('phone', ['member']);
        }
        $request = app(BulkMemberAction::class)->handle(m31Staff('support'), 'revoke_sessions', $ids, m32Reason())->approval;
        // One member is gone before the run: its row fails, the others stand.
        User::query()->whereKey($ids[50])->forceDelete();

        $done = m32Approve($request, $this->approver);

        expect($done->status)->toBe(ApprovalStatus::Executed)
            ->and($done->result['done'])->toBe(100)
            ->and($done->result['failed'])->toBe(1)
            ->and(DB::table('personal_access_tokens')->whereIn('tokenable_id', $ids)->where('tokenable_id', '!=', $ids[50])->count())->toBe(0)
            ->and(AuditEvent::query()->where('action', 'member.sessions_revoked_by_staff')->count())->toBe(100)
            ->and(fn () => m32Approve($done, m31Staff('admin')))->toThrow(ApprovalConflict::class);
    });

    it('ends a run that stopped half-way as failed through approvals:expire', function () {
        $request = app(Approvals::class)->request('audit.export', ['format' => 'csv', 'filter' => []], m32Reason(), $this->requester);
        $request->forceFill(['status' => ApprovalStatus::Executing, 'pending_key' => null, 'decided_by' => $this->approver->id, 'decided_at' => now()])->save();

        expect(app(Approvals::class)->expire()['interrupted'])->toBe(0);

        $this->travel(Approvals::EXECUTING_STALE_MINUTES + 1)->minutes();

        expect(app(Approvals::class)->expire()['interrupted'])->toBe(1)
            ->and($request->refresh()->status)->toBe(ApprovalStatus::Failed)
            ->and($request->result)->toBe(['error' => 'interrupted'])
            ->and(AuditEvent::query()->where('action', 'approval.failed')->count())->toBe(1);
    });
});

describe('SF-4 / SEC-P3-08: the threshold counts over a rolling 24 hours', function () {
    it('asks for approval once one staff member\'s direct runs of an action pass 100 records in 24 hours', function () {
        $support = m31Staff('support');
        $first = User::factory()->count(60)->create()->pluck('id')->all();
        $second = User::factory()->count(60)->create()->pluck('id')->all();

        expect(app(BulkMemberAction::class)->handle($support, 'revoke_sessions', $first, m32Reason())->waitsForApproval())->toBeFalse();

        $split = app(BulkMemberAction::class)->handle($support, 'revoke_sessions', $second, m32Reason());
        expect($split->waitsForApproval())->toBeTrue()
            ->and($split->approval?->action)->toBe('members.bulk')
            ->and(AuditEvent::query()->where('action', 'member.bulk_executed')->count())->toBe(1);

        // Another staff member, and another action of the same one, have windows of their own.
        expect(app(BulkMemberAction::class)->handle(m31Staff('support'), 'revoke_sessions', $second, m32Reason())->waitsForApproval())->toBeFalse()
            ->and(app(BulkMemberAction::class)->handle(m31Staff('moderator'), 'restrict', $second, m32Reason(), [
                'type' => 'messaging', 'until' => null, ...m32Statement()->toArray(),
            ])->waitsForApproval())->toBeFalse();

        $this->travel(BulkRunner::WINDOW_HOURS)->hours();
        $this->travel(1)->minutes();

        expect(app(BulkMemberAction::class)->handle($support, 'revoke_sessions', User::factory()->count(60)->create()->pluck('id')->all(), m32Reason())->waitsForApproval())->toBeFalse();
    });

    it('does not count an approved run towards the window', function () {
        $support = m31Staff('support');
        $big = app(BulkMemberAction::class)->handle($support, 'revoke_sessions', User::factory()->count(101)->create()->pluck('id')->all(), m32Reason());
        m32Approve($big->approval, $this->approver);

        expect(app(BulkMemberAction::class)->handle($support, 'revoke_sessions', User::factory()->count(50)->create()->pluck('id')->all(), m32Reason())->waitsForApproval())->toBeFalse();
    });

    it('asks for approval while another run of the same staff member and action holds its lock', function () {
        $support = m31Staff('support');
        $lock = Cache::lock('admin-bulk:'.$support->id.':members.revoke_sessions', 60);
        expect($lock->get())->toBeTrue();

        expect(app(BulkMemberAction::class)->handle($support, 'revoke_sessions', [$this->member->id], m32Reason())->waitsForApproval())->toBeTrue();

        $lock->release();
    });

    it('applies the same window to the vehicle bulk hide', function () {
        $moderator = m31Staff('moderator');
        $first = Vehicle::factory()->published()->count(60)->create()->pluck('id')->all();
        $second = Vehicle::factory()->published()->count(60)->create()->pluck('id')->all();

        expect(app(BulkHideVehicles::class)->handle($moderator, $first, m32Statement(), m32Reason())->waitsForApproval())->toBeFalse()
            ->and(app(BulkHideVehicles::class)->handle($moderator, $second, m32Statement(), m32Reason())->approval?->action)->toBe('vehicles.bulk_hide')
            ->and(Vehicle::query()->whereIn('id', $second)->where('visibility', Visibility::Private)->count())->toBe(0);
    });

    it('names the first 20 records and how many more in the summary the approver sees', function () {
        $members = User::factory()->count(101)->create();
        $request = app(BulkMemberAction::class)->handle(m31Staff('support'), 'revoke_sessions', $members->pluck('id')->all(), m32Reason())->approval;
        $lines = collect($request->summary['lines'])->keyBy('label');

        expect($lines['approvals.members_bulk.count']['after'])->toBe('101')
            ->and(explode(', ', (string) $lines['approvals.members_bulk.members']['after']))->toHaveCount(20)
            ->and((string) $lines['approvals.members_bulk.members']['after'])->toContain('@'.$members->first()?->username)
            ->and($lines['approvals.members_bulk.more']['after'])->toBe('81');

        $vehicles = Vehicle::factory()->published()->count(101)->create();
        $hide = app(BulkHideVehicles::class)->handle(m31Staff('moderator'), $vehicles->pluck('id')->all(), m32Statement(), m32Reason())->approval;
        $vehicleLines = collect($hide->summary['lines'])->keyBy('label');

        expect(explode(', ', (string) $vehicleLines['approvals.vehicles_bulk_hide.vehicles']['after']))->toHaveCount(20)
            ->and($vehicleLines['approvals.vehicles_bulk_hide.more']['after'])->toBe('81');
    });
});

describe('SF-9: the seeder grants exactly the 06 §2 role table', function () {
    it('matches M32_SPEC_ROLES for every role', function () {
        foreach (M32_SPEC_ROLES as $role => $atoms) {
            $seeded = StaffSeeder::ROLES[$role] ?? [];
            sort($seeded);
            sort($atoms);

            expect($seeded)->toBe($atoms, "StaffSeeder::ROLES[$role] differs from 06_ADMIN_SPEC §2");
        }

        expect(array_keys(StaffSeeder::ROLES))->toEqualCanonicalizing(array_keys(M32_SPEC_ROLES));
    });
});

describe('SF-7: a staff deletion of a vehicle is one transaction', function () {
    it('leaves no decision, no case, no notice and the vehicle in place when the delete fails', function () {
        Queue::fake();
        Storage::fake('public');
        $vehicle = modVehicle($this->member);
        $this->mock(DeleteVehicle::class)->shouldReceive('handle')->andThrow(new RuntimeException('disk full'));

        expect(fn () => app(DeleteVehicleAsStaff::class)->handle($this->requester, $vehicle, m32Statement(), m32Reason()))->toThrow(RuntimeException::class)
            ->and(Decision::query()->count())->toBe(0)
            ->and(ModerationCase::query()->count())->toBe(0)
            ->and(DB::table('notifications')->where('notifiable_id', $this->member->id)->count())->toBe(0)
            ->and(AuditEvent::query()->where('action', 'vehicle.deleted_by_staff')->count())->toBe(0)
            ->and($vehicle->refresh()->trashed())->toBeFalse()
            ->and($vehicle->visibility)->toBe(Visibility::Public);
        Queue::assertNothingPushed();
    });
});
