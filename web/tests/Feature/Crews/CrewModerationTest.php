<?php

use App\Actions\Account\DeleteAccount;
use App\Actions\Crews\Staff\HideCrew;
use App\Actions\Crews\Staff\RemoveCrew;
use App\Actions\Crews\Staff\RestoreCrew;
use App\Actions\Crews\Staff\UnhideCrew;
use App\Enums\CrewRole;
use App\Enums\CrewStatus;
use App\Enums\GroundDocument;
use App\Models\AuditEvent;
use App\Models\Crew;
use App\Models\CrewInvite;
use App\Models\CrewMember;
use App\Models\CrewRequest;
use App\Models\Decision;
use App\Models\Media;
use App\Models\ModerationCase;
use App\Models\Report;
use App\Models\User;
use App\Services\DataExport\ExportContents;
use App\Services\Moderation\Statement;
use Illuminate\Auth\Access\AuthorizationException;
use Laravel\Sanctum\Sanctum;

require_once __DIR__.'/CrewTestHelpers.php';
require_once __DIR__.'/../Staff/Helpers.php';

/**
 * R4-2.3 Crews, moderation and GDPR (contract-crews.md §6, §7, C6, C8): reports through the DSA pipeline, staff hide/unhide (decisions
 * with a statement of reasons) and delete/restore (audited), the founder hand-over or deletion when an account closes, the data export.
 */
beforeEach(function () {
    crewFlags();
});

function crewStatement(): Statement
{
    return new Statement('Der Crew-Name beleidigt eine Gruppe von Menschen.', 'Community-Richtlinien §2 (Respekt)', GroundDocument::Community, '2');
}

it('lets members report a crew they can see; the founder is the subject; their own crew is own_content', function () {
    $founder = User::factory()->create();
    $crew = crewMake($founder);
    Sanctum::actingAs(User::factory()->create());

    $this->postJson('/api/v1/reports', ['target_type' => 'crew', 'target_id' => $crew->id, 'reason' => 'harassment'])->assertCreated();
    $case = ModerationCase::query()->where('target_type', 'crew')->firstOrFail();
    expect($case->subject_id)->toBe($founder->id)->and(Report::query()->where('case_id', $case->id)->value('target_label'))->toBe($crew->name);

    $hidden = crewMake(null, ['status' => CrewStatus::Hidden]);
    $this->postJson('/api/v1/reports', ['target_type' => 'crew', 'target_id' => $hidden->id, 'reason' => 'harassment'])->assertNotFound();

    Sanctum::actingAs($founder);
    $this->postJson('/api/v1/reports', ['target_type' => 'crew', 'target_id' => $crew->id, 'reason' => 'harassment'])->assertUnprocessable()->assertJsonPath('code', 'own_content');
});

it('hides a crew by a decision with a statement of reasons and shows it again by a reversal', function () {
    $founder = User::factory()->create();
    $member = User::factory()->create();
    $crew = crewMake($founder);
    crewAdd($crew, $member);
    $moderator = m31Staff('moderator');

    $decision = app(HideCrew::class)->handle($moderator, $crew, crewStatement(), 'Mehrere Meldungen geprüft.');
    expect($decision)->toBeInstanceOf(Decision::class)->and($crew->refresh()->status)->toBe(CrewStatus::Hidden)
        ->and(AuditEvent::query()->where('action', 'crew.hidden')->where('target_id', $crew->id)->exists())->toBeTrue()
        ->and(AuditEvent::query()->where('action', 'moderation.decided')->exists())->toBeTrue();

    $this->getJson('/api/v1/crews')->assertOk()->assertJsonCount(0, 'data');
    $this->getJson("/api/v1/crews/{$crew->slug}")->assertNotFound();
    Sanctum::actingAs($member);
    $this->getJson("/api/v1/crews/{$crew->slug}")->assertOk()->assertJsonPath('data.status', 'hidden');
    $this->patchJson("/api/v1/crews/{$crew->slug}", ['description' => 'x'])->assertForbidden();

    expect(fn () => app(HideCrew::class)->handle($moderator, $crew->refresh(), crewStatement(), 'Noch einmal.'))->toThrow(DomainException::class);

    app(UnhideCrew::class)->handle($moderator, $crew->refresh(), 'Die Meldung hat sich nicht bestätigt.', 'Zweitprüfung.');
    expect($crew->refresh()->status)->toBe(CrewStatus::Active)
        ->and(AuditEvent::query()->where('action', 'crew.unhidden')->exists())->toBeTrue();
});

it('deletes only a hidden crew as staff and restores it to hidden', function () {
    $crew = crewMake();
    $moderator = m31Staff('moderator');

    expect(fn () => app(RemoveCrew::class)->handle($moderator, $crew, 'Zu früh.'))->toThrow(DomainException::class);

    app(HideCrew::class)->handle($moderator, $crew, crewStatement(), 'Geprüft.');
    app(RemoveCrew::class)->handle($moderator, $crew->refresh(), 'Wiederholter Verstoß.');
    $crew = Crew::withTrashed()->findOrFail($crew->id);
    expect($crew->trashed())->toBeTrue()->and($crew->status)->toBe(CrewStatus::Removed)
        ->and(AuditEvent::query()->where('action', 'crew.removed')->exists())->toBeTrue();

    app(RestoreCrew::class)->handle($moderator, $crew, 'Widerspruch berechtigt.');
    expect($crew->refresh()->trashed())->toBeFalse()->and($crew->status)->toBe(CrewStatus::Hidden)
        ->and(AuditEvent::query()->where('action', 'crew.restored')->exists())->toBeTrue();
});

it('needs moderation.decide for the staff actions', function () {
    $crew = crewMake();
    $analyst = m31Staff('analyst');

    expect(fn () => app(HideCrew::class)->handle($analyst, $crew, crewStatement(), 'x'))->toThrow(AuthorizationException::class)
        ->and(fn () => app(RemoveCrew::class)->handle($analyst, $crew, 'x'))->toThrow(AuthorizationException::class);
});

it('decides a crew report with remove_content by hiding it', function () {
    $crew = crewMake();
    Sanctum::actingAs(User::factory()->create());
    $this->postJson('/api/v1/reports', ['target_type' => 'crew', 'target_id' => $crew->id, 'reason' => 'harassment'])->assertCreated();

    app(HideCrew::class)->handle(m31Staff('moderator'), $crew, crewStatement(), 'Meldung bestätigt.');
    $case = ModerationCase::query()->where('target_type', 'crew')->firstOrFail();
    expect($case->status->value)->not->toBe('open')->and($crew->refresh()->status)->toBe(CrewStatus::Hidden);
});

it('hands founded crews to the oldest admin, else the oldest member, else deletes them when an account closes', function () {
    $closing = User::factory()->create();
    $withAdmin = crewMake($closing);
    $olderMember = User::factory()->create();
    crewAdd($withAdmin, $olderMember);
    $admin = User::factory()->create();
    crewAdd($withAdmin, $admin, CrewRole::Admin);
    $logo = Media::factory()->forModel($withAdmin)->create(['owner_id' => $closing->id]);
    $withAdmin->forceFill(['logo_media_id' => $logo->id])->save();

    $onlyMember = crewMake($closing);
    $member = User::factory()->create();
    crewAdd($onlyMember, $member);

    $alone = crewMake($closing);
    $joined = crewMake();
    crewAdd($joined, $closing);
    $request = CrewRequest::factory()->create(['user_id' => $closing->id]);
    CrewInvite::factory()->create(['user_id' => $closing->id]);

    app(DeleteAccount::class)->handle($closing);

    expect($withAdmin->roleOf($admin))->toBe(CrewRole::Founder)
        ->and($withAdmin->roleOf($olderMember))->toBe(CrewRole::Member)
        ->and($logo->refresh()->owner_id)->toBe($admin->id)
        ->and($onlyMember->roleOf($member))->toBe(CrewRole::Founder)
        ->and(Crew::withTrashed()->findOrFail($alone->id)->trashed())->toBeTrue()
        ->and(CrewMember::query()->where('user_id', $closing->id)->exists())->toBeFalse()
        ->and($joined->refresh()->members_count)->toBe(1)
        ->and(CrewRequest::query()->whereKey($request->id)->exists())->toBeFalse()
        ->and(CrewInvite::query()->where('user_id', $closing->id)->exists())->toBeFalse();
});

it('exports the member crews, roles, requests and invitations', function () {
    $me = User::factory()->create();
    $crew = crewMake($me, ['name' => 'Export Crew', 'name_key' => 'export crew']);
    $other = crewMake(null, ['name' => 'Andere Crew', 'name_key' => 'andere crew']);
    CrewRequest::factory()->create(['crew_id' => $other->id, 'user_id' => $me->id]);
    $invitee = User::factory()->create(['username' => 'export.gast']);
    CrewInvite::factory()->create(['crew_id' => $crew->id, 'user_id' => $invitee->id, 'invited_by' => $me->id]);

    $export = app(ExportContents::class)->documents($me)['crews.json'];

    expect($export['memberships'])->toHaveCount(1)->and($export['memberships'][0]['crew'])->toBe('Export Crew')
        ->and($export['memberships'][0]['role'])->toBe('founder')->and($export['memberships'][0]['url'])->toBe('/crews/'.$crew->slug)
        ->and($export['requests'][0]['crew'])->toBe('Andere Crew')
        ->and($export['invites_sent'][0]['username'])->toBe('export.gast')
        ->and($export['invites_received'])->toBe([]);
});
