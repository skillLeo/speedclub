<?php

use App\Actions\Admin\Members\BulkMemberAction;
use App\Actions\Admin\Members\DeleteMemberAsStaff;
use App\Actions\Admin\Members\DownloadMemberExport;
use App\Actions\Admin\Members\ExportMemberData;
use App\Actions\Admin\Members\RequestMemberDeletion;
use App\Actions\Admin\Members\RequestMemberExport;
use App\Enums\ApprovalStatus;
use App\Enums\DataExportStatus;
use App\Enums\RestrictionType;
use App\Enums\UserStatus;
use App\Mail\DataExportReadyMail;
use App\Models\AuditEvent;
use App\Models\DataExport;
use App\Models\Decision;
use App\Models\User;
use App\Services\Approvals\Approvals;
use App\Services\DataExport\BuildDataExport;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use Laravel\Sanctum\Sanctum;

require_once __DIR__.'/Helpers.php';

/**
 * M3.2 §2 (ADM-09/10): export and deletion are always four-eyes; bulk actions run per record with a result row each, and more than
 * 100 records (or export and delete at any count) go through `members.bulk`, which both staff members need the action's atom for.
 */
beforeEach(function () {
    $this->withoutDefer();
    Mail::fake();
    $this->member = User::factory()->create(['username' => 'mia.rs3', 'locale' => 'de']);
});

describe('Export (four-eyes)', function () {
    it('builds the SET-12 export for the requester only: not listed for the member, never mailed to them', function () {
        Storage::fake('local');
        $support = m31Staff('admin');
        $request = app(RequestMemberExport::class)->handle($support, $this->member, m32Reason());

        expect($request->status)->toBe(ApprovalStatus::Pending)->and(DataExport::query()->count())->toBe(0);

        $done = m32Approve($request);
        $export = DataExport::query()->sole();

        expect($done->status)->toBe(ApprovalStatus::Executed)
            ->and($done->result['export_id'])->toBe($export->id)
            ->and($export->requested_by_staff_id)->toBe($support->id)
            ->and($export->refresh()->status)->toBe(DataExportStatus::Ready)
            // The approval's download window, not the member's 7 days.
            ->and((int) round(now()->diffInHours($export->expires_at)))->toBe(24);
        Mail::assertNotSent(DataExportReadyMail::class);

        Sanctum::actingAs($this->member, ['member']);
        $this->getJson('/api/v1/me/exports')->assertOk()->assertJsonCount(0, 'data');
        $this->get(BuildDataExport::downloadUrl($export, $this->member))->assertNotFound();

        expect(app(DownloadMemberExport::class)->handle($support, $export))->toBe(BuildDataExport::zipPath($export))
            ->and(fn () => app(DownloadMemberExport::class)->handle(m31Staff('admin'), $export))->toThrow(AuthorizationException::class)
            ->and(AuditEvent::query()->where('action', 'member.export_downloaded')->count())->toBe(1)
            ->and(AuditEvent::query()->where('action', 'member.export_started')->sole()->after['requested_by'])->toBe($support->id);
    });

    it('does not count against the member\'s own 24-hour cooldown', function () {
        Queue::fake();
        m32Approve(app(RequestMemberExport::class)->handle(m31Staff('admin'), $this->member, m32Reason()));
        expect(DataExport::query()->sole()->requested_by_staff_id)->not->toBeNull();
        $this->member->forceFill(['password' => 'Sicher-genug-2026!'])->save();

        Sanctum::actingAs($this->member, ['member']);
        $this->postJson('/api/v1/me/export', ['password' => 'Sicher-genug-2026!'], ['Idempotency-Key' => (string) Str::uuid()])->assertStatus(202);
    });

    it('refuses the requester as approver and staff without members.export', function () {
        $admin = m31Staff('admin');

        expect(fn () => app(RequestMemberExport::class)->handle(m31Staff('support'), $this->member, m32Reason()))->toThrow(AuthorizationException::class)
            ->and(fn () => app(ExportMemberData::class)->handle($admin, $admin, $this->member, m32Reason()))->toThrow(AuthorizationException::class)
            ->and(fn () => m32Approve(app(RequestMemberExport::class)->handle($admin, $this->member, m32Reason()), $admin))->toThrow(AuthorizationException::class)
            ->and(DataExport::query()->count())->toBe(0);
    });
});

describe('Löschen (four-eyes)', function () {
    it('closes the account as SET-13 does on approval, mails the member and names both staff members', function () {
        $requester = m31Staff('admin');
        $request = app(RequestMemberDeletion::class)->handle($requester, $this->member, m32Reason());

        expect($this->member->refresh()->status)->toBe(UserStatus::Active);

        $approver = m31Staff('owner');
        expect(m32Approve($request, $approver)->status)->toBe(ApprovalStatus::Executed)
            ->and($this->member->refresh()->status)->toBe(UserStatus::Deactivated)
            ->and($this->member->isPendingDeletion())->toBeTrue();

        $event = AuditEvent::query()->where('action', 'member.deleted_by_staff')->sole();
        expect($event->after['requested_by'])->toBe($requester->id)->and($event->after['approved_by'])->toBe($approver->id)
            ->and(AuditEvent::query()->where('action', 'member.deletion_requested')->exists())->toBeTrue();
    });

    it('refuses staff without members.delete, one person on both sides, and an account already closing', function () {
        $admin = m31Staff('admin');

        expect(fn () => app(RequestMemberDeletion::class)->handle(m31Staff('moderator'), $this->member, m32Reason()))->toThrow(AuthorizationException::class)
            ->and(fn () => app(DeleteMemberAsStaff::class)->handle($admin, $admin, $this->member, m32Reason()))->toThrow(AuthorizationException::class)
            ->and($this->member->refresh()->status)->toBe(UserStatus::Active);

        expect(m32Approve(app(RequestMemberDeletion::class)->handle($admin, $this->member, m32Reason()))->status)->toBe(ApprovalStatus::Executed);

        expect(fn () => app(RequestMemberDeletion::class)->handle($admin, $this->member->refresh(), m32Reason()))->toThrow(DomainException::class);
    });
});

describe('Bulk', function () {
    it('runs up to 100 records at once with a result row each', function () {
        $other = User::factory()->create();
        $this->member->createToken('phone', ['member']);
        $other->createToken('phone', ['member']);
        $missing = strtolower((string) Str::ulid());

        $outcome = app(BulkMemberAction::class)->handle(m31Staff('support'), 'revoke_sessions', [$this->member->id, $other->id, $missing], m32Reason());

        expect($outcome->waitsForApproval())->toBeFalse()
            ->and($outcome->rows)->toBe([
                ['id' => $this->member->id, 'ok' => true, 'code' => null],
                ['id' => $other->id, 'ok' => true, 'code' => null],
                ['id' => $missing, 'ok' => false, 'code' => 'not_found'],
            ])
            ->and($this->member->tokens()->count() + $other->tokens()->count())->toBe(0)
            ->and(AuditEvent::query()->where('action', 'member.bulk_executed')->sole()->after['done'])->toBe(2);
    });

    it('restricts in bulk with one decision per member', function () {
        $other = User::factory()->create();

        $outcome = app(BulkMemberAction::class)->handle(m31Staff('moderator'), 'restrict', [$this->member->id, $other->id], m32Reason(), [
            'type' => 'publishing', 'until' => now()->addDays(7)->toIso8601String(), ...m32Statement()->toArray(),
        ]);

        expect($outcome->counts())->toBe(['done' => 2, 'failed' => 0])
            ->and($this->member->refresh()->isRestrictedFrom(RestrictionType::Publishing))->toBeTrue()
            ->and(Decision::query()->count())->toBe(2);
    });

    it('asks for approval above 100 records and for export or delete at any count; nothing runs until then', function () {
        $ids = User::factory()->count(101)->create()->pluck('id')->all();
        $support = m31Staff('support');

        $big = app(BulkMemberAction::class)->handle($support, 'revoke_sessions', $ids, m32Reason());
        $export = app(BulkMemberAction::class)->handle(m31Staff('admin'), 'export', [$this->member->id], m32Reason());

        expect($big->waitsForApproval())->toBeTrue()
            ->and($big->approval?->action)->toBe('members.bulk')
            ->and($export->waitsForApproval())->toBeTrue()
            ->and(DataExport::query()->count())->toBe(0)
            ->and(AuditEvent::query()->where('action', 'member.bulk_executed')->count())->toBe(0);

        // The approver needs the action's own atom too: a moderator holds approvals.decide nowhere by default, an admin does.
        expect(app(Approvals::class)->mayDecide($big->approval, m31Staff('admin')))->toBeTrue();

        $done = m32Approve($big->approval);
        expect($done->status)->toBe(ApprovalStatus::Executed)
            ->and($done->result['done'])->toBe(101)
            ->and(count($done->result['rows']))->toBe(101);
    });

    it('lets nobody without the action\'s atom ask, and checks the ids and options', function () {
        expect(fn () => app(BulkMemberAction::class)->handle(m31Staff('support'), 'delete', [$this->member->id], m32Reason()))->toThrow(AuthorizationException::class)
            ->and(fn () => app(BulkMemberAction::class)->handle(m31Staff('admin'), 'explode', [$this->member->id], m32Reason()))->toThrow(ValidationException::class)
            ->and(fn () => app(BulkMemberAction::class)->handle(m31Staff('admin'), 'restrict', [$this->member->id], m32Reason(), ['type' => 'messaging']))->toThrow(ValidationException::class)
            ->and(fn () => app(BulkMemberAction::class)->handle(m31Staff('admin'), 'revoke_sessions', ['not-an-id'], m32Reason()))->toThrow(ValidationException::class)
            ->and(fn () => app(BulkMemberAction::class)->execute(m31Staff('admin'), null, 'delete', [$this->member->id], m32Reason(), []))->toThrow(AuthorizationException::class)
            ->and($this->member->refresh()->status)->toBe(UserStatus::Active);
    });
});
