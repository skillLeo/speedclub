<?php

use App\Actions\Admin\Media\ApproveMedia;
use App\Actions\Admin\Media\HideMedia;
use App\Actions\Admin\Media\UnhideMedia;
use App\Actions\Admin\Qr\ReissueQrCodeAsStaff;
use App\Actions\Admin\Qr\RevokeQrCode;
use App\Actions\Admin\Vehicles\BulkHideVehicles;
use App\Actions\Admin\Vehicles\DeleteVehicleAsStaff;
use App\Actions\Admin\Vehicles\EditVehicle;
use App\Actions\Admin\Vehicles\HideVehicle;
use App\Actions\Admin\Vehicles\UnhideVehicle;
use App\Enums\ApprovalStatus;
use App\Enums\CaseOrigin;
use App\Enums\DecisionAction;
use App\Enums\ModerationStatus;
use App\Enums\QrRevocationReason;
use App\Enums\QrStatus;
use App\Enums\Visibility;
use App\Mail\DecisionReversedMail;
use App\Mail\ModerationDecisionMail;
use App\Mail\QrCodeChangedByStaffMail;
use App\Models\AuditEvent;
use App\Models\Decision;
use App\Models\ModerationCase;
use App\Models\QrCode;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\Moderation\ModerationHolds;
use App\Services\Qr\QrCodes;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;

require_once __DIR__.'/Helpers.php';

/**
 * M3.2 §2 (ADM-11…13, 18, 19): hiding a vehicle or photo is a remove_content decision the owner hears of with the statement of reasons,
 * showing it again a reverse decision; edits and deletes are audited; QR takedowns and reissues tell the owner.
 */
beforeEach(function () {
    $this->withoutDefer();
    Mail::fake();
    Storage::fake('public');
    Storage::fake(config()->string('speedclub.media.private_disk'));
    $this->owner = User::factory()->create(['username' => 'jonas.m3', 'locale' => 'de']);
    $this->vehicle = modVehicle($this->owner)->refresh();
});

describe('Fahrzeug ausblenden / einblenden', function () {
    it('hides with a decision on an own-initiative case: private, held, owner told; unhiding restores the visibility', function () {
        expect($this->vehicle->visibility)->toBe(Visibility::Public);

        $decision = app(HideVehicle::class)->handle(m31Staff('moderator'), $this->vehicle, m32Statement(), m32Reason());

        expect($decision->action)->toBe(DecisionAction::RemoveContent)
            ->and(ModerationCase::query()->findOrFail($decision->case_id)->origin)->toBe(CaseOrigin::Staff)
            ->and($this->vehicle->refresh()->visibility)->toBe(Visibility::Private)
            ->and(app(ModerationHolds::class)->holds($this->vehicle))->toBeTrue()
            ->and($decision->restore)->toBe(['visibility' => 'public']);
        Mail::assertSent(ModerationDecisionMail::class);

        $reverse = app(UnhideVehicle::class)->handle(m31Staff('moderator'), $this->vehicle, 'Der Hinweis war falsch, der Build ist in Ordnung.', m32Reason());

        expect($reverse->reverses_decision_id)->toBe($decision->id)
            ->and($this->vehicle->refresh()->visibility)->toBe(Visibility::Public)
            ->and(app(ModerationHolds::class)->holds($this->vehicle))->toBeFalse();
        Mail::assertSent(DecisionReversedMail::class);
    });

    it('lets the owner make it public again only after the reversal', function () {
        app(HideVehicle::class)->handle(m31Staff('admin'), $this->vehicle, m32Statement(), m32Reason());
        Sanctum::actingAs($this->owner, ['member']);

        $this->patchJson("/api/v1/vehicles/{$this->vehicle->id}/visibility", ['visibility' => 'public'])->assertForbidden();

        app(UnhideVehicle::class)->handle(m31Staff('admin'), $this->vehicle, 'Wieder sichtbar, alles geprüft.', m32Reason());
        $this->vehicle->refresh()->forceFill(['visibility' => Visibility::Private])->save();

        $this->patchJson("/api/v1/vehicles/{$this->vehicle->id}/visibility", ['visibility' => 'public'])->assertOk();
    });

    it('refuses hiding twice, unhiding what nothing hides, and staff without vehicles.hide', function (string $role, bool $allowed) {
        $staff = m31Staff($role);

        if (! $allowed) {
            expect(fn () => app(HideVehicle::class)->handle($staff, $this->vehicle, m32Statement(), m32Reason()))->toThrow(AuthorizationException::class)
                ->and(fn () => app(UnhideVehicle::class)->handle($staff, $this->vehicle, 'Wieder sichtbar.', m32Reason()))->toThrow(AuthorizationException::class);

            return;
        }

        expect(fn () => app(UnhideVehicle::class)->handle($staff, $this->vehicle, 'Wieder sichtbar.', m32Reason()))->toThrow(DomainException::class);
        app(HideVehicle::class)->handle($staff, $this->vehicle, m32Statement(), m32Reason());
        expect(fn () => app(HideVehicle::class)->handle($staff, $this->vehicle, m32Statement(), m32Reason()))->toThrow(DomainException::class)
            ->and(Decision::query()->count())->toBe(1);
    })->with(m32Matrix('vehicles.hide'));

    it('hides up to 100 vehicles at once and asks for approval above that', function () {
        $second = modVehicle();
        $outcome = app(BulkHideVehicles::class)->handle(m31Staff('moderator'), [$this->vehicle->id, $second->id], m32Statement(), m32Reason());

        expect($outcome->counts())->toBe(['done' => 2, 'failed' => 0])
            ->and($second->refresh()->visibility)->toBe(Visibility::Private);

        $ids = Vehicle::factory()->published()->count(101)->create()->pluck('id')->all();
        $big = app(BulkHideVehicles::class)->handle(m31Staff('moderator'), $ids, m32Statement(), m32Reason());

        expect($big->approval?->action)->toBe('vehicles.bulk_hide')
            ->and(Vehicle::query()->whereIn('id', $ids)->where('visibility', Visibility::Private)->count())->toBe(0);

        $done = m32Approve($big->approval);
        expect($done->status)->toBe(ApprovalStatus::Executed)
            ->and($done->result['done'])->toBe(101)
            ->and(Vehicle::query()->whereIn('id', $ids)->where('visibility', Visibility::Private)->count())->toBe(101);
    });
});

describe('Fahrzeug bearbeiten / löschen', function () {
    it('edits the title fields, audited, without counting as news of the build', function () {
        $updated = $this->vehicle->updated_at;
        $this->travel(5)->minutes();

        app(EditVehicle::class)->handle(m31Staff('admin'), $this->vehicle, ['nickname' => 'Weißer Blitz', 'owner_id' => 'x'], m32Reason());

        expect($this->vehicle->refresh()->nickname)->toBe('Weißer Blitz')
            ->and($this->vehicle->owner_id)->toBe($this->owner->id)
            ->and($this->vehicle->updated_at?->equalTo($updated))->toBeTrue()
            ->and(AuditEvent::query()->where('action', 'vehicle.edited_by_staff')->sole()->after['nickname'])->toBe('Weißer Blitz')
            ->and(fn () => app(EditVehicle::class)->handle(m31Staff('moderator'), $this->vehicle, ['nickname' => 'X'], m32Reason()))->toThrow(AuthorizationException::class);
    });

    it('deletes with a decision the owner is told of, then the member delete path: soft-deleted, QR revoked', function () {
        $qr = app(QrCodes::class)->ensureActive($this->vehicle);

        app(DeleteVehicleAsStaff::class)->handle(m31Staff('admin'), $this->vehicle, m32Statement(), m32Reason());

        expect(Vehicle::withTrashed()->findOrFail($this->vehicle->id)->trashed())->toBeTrue()
            ->and($qr->refresh()->status)->toBe(QrStatus::Revoked)
            ->and(Decision::query()->sole()->action)->toBe(DecisionAction::RemoveContent)
            ->and(AuditEvent::query()->where('action', 'vehicle.deleted_by_staff')->exists())->toBeTrue()
            ->and(fn () => app(DeleteVehicleAsStaff::class)->handle(m31Staff('moderator'), modVehicle(), m32Statement(), m32Reason()))->toThrow(AuthorizationException::class);
        Mail::assertSent(ModerationDecisionMail::class);
    });
});

describe('Medienprüfung', function () {
    it('approves a new photo: reviewed by whom and when, audited', function () {
        $photo = modPhoto($this->vehicle);
        $staff = m31Staff('moderator');

        app(ApproveMedia::class)->handle($staff, $photo);

        expect($photo->refresh()->reviewed_by)->toBe($staff->id)
            ->and($photo->reviewed_at)->not->toBeNull()
            ->and($photo->moderation_status)->toBe(ModerationStatus::Approved)
            ->and(AuditEvent::query()->where('action', 'media.reviewed')->count())->toBe(1)
            ->and(fn () => app(ApproveMedia::class)->handle(m31Staff('support'), $photo))->toThrow(AuthorizationException::class);
    });

    it('hides a photo with a decision and brings it back, its variants drawn again from the private original', function () {
        $photo = modPhoto($this->vehicle);
        $image = imagecreatetruecolor(400, 300);
        ob_start();
        imagejpeg($image);
        Storage::disk(config()->string('speedclub.media.private_disk'))->put((string) $photo->getAttribute('original_path'), (string) ob_get_clean());

        app(HideMedia::class)->handle(m31Staff('moderator'), $photo, m32Statement(), m32Reason());

        expect($photo->refresh()->moderation_status)->toBe(ModerationStatus::Rejected)
            ->and($photo->getAttribute('variants'))->toBeNull()
            ->and($photo->reviewed_at)->not->toBeNull()
            ->and(fn () => app(ApproveMedia::class)->handle(m31Staff('moderator'), $photo))->toThrow(DomainException::class);

        app(UnhideMedia::class)->handle(m31Staff('moderator'), $photo, 'Kein Kennzeichen zu sehen, alles in Ordnung.', m32Reason());

        $variants = $photo->refresh()->getAttribute('variants');
        expect($photo->moderation_status)->toBe(ModerationStatus::Approved)
            ->and($variants)->toBeArray()->not->toBeEmpty()
            ->and(Storage::disk('public')->exists((string) reset($variants)))->toBeTrue();
    });

    it('refuses hiding without media.hide', function (string $role, bool $allowed) {
        $run = fn () => app(HideMedia::class)->handle(m31Staff($role), modPhoto($this->vehicle), m32Statement(), m32Reason());

        $allowed ? expect($run())->toBeInstanceOf(Decision::class) : expect($run)->toThrow(AuthorizationException::class);
    })->with(m32Matrix('media.hide'));
});

describe('QR', function () {
    it('takes a code down with reason moderation, so the owner cannot reissue it; staff can, and the owner is told both times', function () {
        $qr = app(QrCodes::class)->ensureActive($this->vehicle);

        app(RevokeQrCode::class)->handle(m31Staff('admin'), $qr, m32Reason());

        expect($qr->refresh()->status)->toBe(QrStatus::Revoked)
            ->and($qr->getAttribute('revoked_reason'))->toBe(QrRevocationReason::Moderation);
        Mail::assertSent(QrCodeChangedByStaffMail::class, fn (QrCodeChangedByStaffMail $mail): bool => $mail->change === 'revoked' && $mail->hasTo($this->owner->email));

        Sanctum::actingAs($this->owner, ['member']);
        $this->postJson("/api/v1/vehicles/{$this->vehicle->id}/qr/reissue", [], ['Idempotency-Key' => (string) Str::uuid()])
            ->assertForbidden()->assertJsonPath('code', 'qr_revoked_by_staff');

        $new = app(ReissueQrCodeAsStaff::class)->handle(m31Staff('admin'), $qr, m32Reason());

        expect($new->status)->toBe(QrStatus::Active)
            ->and($new->code)->not->toBe($qr->code)
            ->and(QrCode::query()->where('vehicle_id', $this->vehicle->id)->where('status', QrStatus::Active)->count())->toBe(1)
            ->and(AuditEvent::query()->where('action', 'qr.reissued_by_staff')->sole()->after['code'])->toBe($new->code);
        Mail::assertSent(QrCodeChangedByStaffMail::class, fn (QrCodeChangedByStaffMail $mail): bool => $mail->change === 'reissued');
    });

    it('refuses without qr.revoke and for a code that is not active', function (string $role, bool $allowed) {
        $qr = app(QrCodes::class)->ensureActive($this->vehicle);
        $run = fn () => app(RevokeQrCode::class)->handle(m31Staff($role), $qr, m32Reason());

        if (! $allowed) {
            expect($run)->toThrow(AuthorizationException::class)->and($qr->refresh()->status)->toBe(QrStatus::Active);

            return;
        }

        $run();
        expect($run)->toThrow(DomainException::class);
    })->with(m32Matrix('qr.revoke'));
});
