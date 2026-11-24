<?php

use App\Actions\Account\DeleteAccount;
use App\Actions\Crews\CrewRoles;
use App\Actions\Crews\JoinCrew;
use App\Actions\Crews\Staff\HideCrew;
use App\Actions\Crews\Staff\RemoveCrew;
use App\Actions\Crews\Staff\RestoreCrew;
use App\Actions\Crews\Staff\UnhideCrew;
use App\Enums\CrewJoinMode;
use App\Enums\CrewRole;
use App\Enums\CrewStatus;
use App\Enums\GroundDocument;
use App\Enums\ModerationStatus;
use App\Enums\ReportTargetType;
use App\Exceptions\ApiException;
use App\Models\Crew;
use App\Models\CrewInvite;
use App\Models\CrewMember;
use App\Models\CrewRequest;
use App\Models\Media;
use App\Models\ModerationCase;
use App\Models\Notification;
use App\Models\User;
use App\Services\Admin\Media\MediaOriginals;
use App\Services\Crews\CrewPurge;
use App\Services\Moderation\CaseRecord;
use App\Services\Moderation\Statement;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;

require_once __DIR__.'/CrewTestHelpers.php';
require_once __DIR__.'/../Staff/Helpers.php';

/**
 * docs/reports/round-4/review-server.md, the crew items: MF-1, MF-2, SF-1…SF-4, SF-6, SF-7, SF-10, SF-11 and nits 6, 8, 9. Each test
 * fails on the code before the fix.
 */
beforeEach(function () {
    crewFlags();
    Storage::fake(config()->string('speedclub.media.disk'));
    Storage::fake(config()->string('speedclub.media.private_disk'));
});

function crewFixStatement(): Statement
{
    return new Statement('Das Crew-Logo zeigt ein verbotenes Symbol.', 'Community-Richtlinien §2 (Respekt)', GroundDocument::Community, '2');
}

function crewFixLogo(Crew $crew, User $by): Media
{
    Sanctum::actingAs($by);
    test()->post("/api/v1/crews/{$crew->slug}/logo", ['file' => UploadedFile::fake()->image('logo.jpg', 512, 512)], ['Accept' => 'application/json'])->assertCreated();

    return Media::query()->findOrFail($crew->refresh()->logo_media_id);
}

it('MF-1: leaves invitations of a member who blocked the reading admin out, and hides an inviter across a block', function () {
    $founder = User::factory()->create();
    $crew = crewMake($founder);
    $adminA = User::factory()->create();
    $adminB = User::factory()->create();
    crewAdd($crew, $adminA, CrewRole::Admin);
    crewAdd($crew, $adminB, CrewRole::Admin);
    $invitee = User::factory()->create();
    CrewInvite::factory()->create(['crew_id' => $crew->id, 'user_id' => $invitee->id, 'invited_by' => $adminB->id]);
    socBlock($invitee, $adminA);

    Sanctum::actingAs($adminA);
    $this->getJson("/api/v1/crews/{$crew->slug}/invites")->assertOk()->assertJsonCount(0, 'data');
    Sanctum::actingAs($adminB);
    $this->getJson("/api/v1/crews/{$crew->slug}/invites")->assertOk()->assertJsonCount(1, 'data');

    socBlock($adminB, $founder);
    Sanctum::actingAs($founder);
    $this->getJson("/api/v1/crews/{$crew->slug}/invites")->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.invited_by', null);
});

it('MF-2 / SF-11: hiding and removing take logo and cover off the public disk, staff still reveal the original, unhiding brings them back', function () {
    $founder = User::factory()->create();
    $member = User::factory()->create();
    $crew = crewMake($founder);
    crewAdd($crew, $member);
    $logo = crewFixLogo($crew, $founder);
    expect($logo->getAttribute('variants'))->not->toBeNull();
    $moderator = m31Staff('moderator');

    app(HideCrew::class)->handle($moderator, $crew->refresh(), crewFixStatement(), 'Logo geprüft.');
    $logo->refresh();
    expect($logo->getAttribute('variants'))->toBeNull()->and($logo->moderation_status)->toBe(ModerationStatus::Rejected);
    Sanctum::actingAs($member);
    $this->getJson("/api/v1/crews/{$crew->slug}")->assertOk()->assertJsonPath('data.logo', null);

    $case = ModerationCase::query()->where('target_type', 'crew')->firstOrFail();
    expect(app(CaseRecord::class)->preview($case))->toHaveKey('logo_media_id', $logo->id)
        ->and(app(MediaOriginals::class)->pathOf($logo))->toBe($logo->getAttribute('original_path'));

    app(RemoveCrew::class)->handle($moderator, $crew->refresh(), 'Endgültig.');
    expect($logo->refresh()->getAttribute('variants'))->toBeNull();

    app(RestoreCrew::class)->handle($moderator, Crew::withTrashed()->findOrFail($crew->id), 'Widerspruch berechtigt.');
    expect($logo->refresh()->getAttribute('variants'))->toBeNull();

    app(UnhideCrew::class)->handle($moderator, $crew->refresh(), 'Das Logo ist zulässig.', 'Zweitprüfung.');
    $logo->refresh();
    // Back to the status it had before the hiding, with its public files drawn again from the original.
    expect($logo->moderation_status)->not->toBe(ModerationStatus::Rejected)->and($logo->getAttribute('variants'))->not->toBeNull();
});

it('SF-1: decides removals and role changes on the rows as they are under the lock', function () {
    $founder = User::factory()->create();
    $crew = crewMake($founder);
    $admin = User::factory()->create();
    $heir = User::factory()->create();
    crewAdd($crew, $admin, CrewRole::Admin);
    $stale = crewAdd($crew, $heir)->load('user');

    // The founder handed over to the heir after the admin's request read the row.
    app(CrewRoles::class)->handOver($founder, $crew, CrewMember::query()->with('user')->findOrFail($stale->id));

    expect(fn () => app(CrewRoles::class)->remove($admin, $crew, $stale))->toThrow(ApiException::class);
    expect($crew->roleOf($heir))->toBe(CrewRole::Founder);

    // The old founder (now admin) acts on a stale page.
    expect(fn () => app(CrewRoles::class)->changeRole($founder, $crew, $stale, CrewRole::Member))->toThrow(ApiException::class);
    expect(CrewMember::query()->where('crew_id', $crew->id)->where('role', CrewRole::Founder->value)->count())->toBe(1);
});

it('SF-2: refuses a join of a crew that was hidden or deleted after the reader loaded it', function () {
    $crew = crewMake();
    $member = User::factory()->create();
    Crew::query()->whereKey($crew->id)->update(['status' => CrewStatus::Hidden->value]);
    expect(fn () => app(JoinCrew::class)->join($member, $crew))->toThrow(ApiException::class);

    $deleted = crewMake();
    Crew::query()->whereKey($deleted->id)->update(['deleted_at' => now()]);
    expect(fn () => app(JoinCrew::class)->join($member, $deleted))->toThrow(ApiException::class)
        ->and(CrewMember::query()->where('user_id', $member->id)->exists())->toBeFalse();
});

it('SF-3 / SF-10: a staff-removed crew holds no slot and leaves "Meine Crews"; a request to a hidden crew can be withdrawn and does not count', function () {
    $me = User::factory()->create();
    $crews = [];
    foreach (range(1, 5) as $i) {
        $crews[] = crewMake();
        crewAdd($crews[$i - 1], $me);
    }
    Crew::query()->whereKey($crews[0]->id)->update(['status' => CrewStatus::Removed->value, 'deleted_at' => now()]);

    Sanctum::actingAs($me);
    $this->getJson('/api/v1/me/crews')->assertOk()->assertJsonCount(4, 'data');
    $this->postJson('/api/v1/crews/'.crewMake()->slug.'/join')->assertOk()->assertJsonPath('data.viewer.state', 'member');

    $asker = User::factory()->create();
    $hidden = crewMake(null, ['status' => CrewStatus::Hidden], CrewJoinMode::Request);
    CrewRequest::factory()->create(['crew_id' => $hidden->id, 'user_id' => $asker->id]);
    foreach (range(1, 9) as $i) {
        CrewRequest::factory()->create(['user_id' => $asker->id]);
    }
    Sanctum::actingAs($asker);
    $this->postJson('/api/v1/crews/'.crewMake(null, [], CrewJoinMode::Request)->slug.'/join')->assertOk()->assertJsonPath('data.viewer.state', 'requested');
    $this->deleteJson("/api/v1/crews/{$hidden->slug}/join-request")->assertNoContent();
    expect(CrewRequest::query()->where('crew_id', $hidden->id)->exists())->toBeFalse();
});

it('SF-4: an admin\'s logo passes to the founder when the admin leaves or closes the account', function () {
    $founder = User::factory()->create();
    $crew = crewMake($founder);
    $admin = User::factory()->create();
    crewAdd($crew, $admin, CrewRole::Admin);
    $logo = crewFixLogo($crew, $admin);
    expect($logo->owner_id)->toBe($admin->id);

    Sanctum::actingAs($admin);
    $this->postJson("/api/v1/crews/{$crew->slug}/leave")->assertNoContent();
    expect($logo->refresh()->owner_id)->toBe($founder->id);

    $second = User::factory()->create();
    crewAdd($crew, $second, CrewRole::Admin);
    $cover = Media::factory()->forModel($crew)->create(['owner_id' => $second->id]);
    app(DeleteAccount::class)->handle($second);
    expect($cover->refresh()->owner_id)->toBe($founder->id);
});

it('SF-6: join ignores an invitation across a block between member and inviter', function () {
    $founder = User::factory()->create();
    $crew = crewMake($founder, [], CrewJoinMode::Invite);
    $me = User::factory()->create();
    CrewInvite::factory()->create(['crew_id' => $crew->id, 'user_id' => $me->id, 'invited_by' => $founder->id]);
    socBlock($me, $founder);

    Sanctum::actingAs($me);
    $this->postJson("/api/v1/crews/{$crew->slug}/join")->assertForbidden();
    expect($crew->roleOf($me))->toBeNull();
});

it('SF-7: accepting an invitation of a staff-removed crew answers 404 crew_unavailable', function () {
    $founder = User::factory()->create();
    $crew = crewMake($founder);
    $me = User::factory()->create();
    $invite = CrewInvite::factory()->create(['crew_id' => $crew->id, 'user_id' => $me->id, 'invited_by' => $founder->id]);
    Crew::query()->whereKey($crew->id)->update(['status' => CrewStatus::Removed->value, 'deleted_at' => now()]);

    Sanctum::actingAs($me);
    $this->postJson("/api/v1/me/crew-invites/{$invite->id}/accept")->assertNotFound()->assertJsonPath('code', 'crew_unavailable');
});

it('nit 6: held crews never starve the purge batch', function () {
    $held = crewMake();
    $free = crewMake();
    Crew::query()->whereKey($held->id)->update(['deleted_at' => now()->subDays(60)]);
    Crew::query()->whereKey($free->id)->update(['deleted_at' => now()->subDays(40)]);
    ModerationCase::factory()->create(['target_type' => 'crew', 'target_id' => $held->id, 'open_target' => ModerationCase::openKey(ReportTargetType::Crew, $held->id)]);

    expect(app(CrewPurge::class)->run(1))->toBe(1)
        ->and(Crew::withTrashed()->find($free->id))->toBeNull()
        ->and(Crew::withTrashed()->find($held->id))->not->toBeNull();
});

it('nit 8: hands over only to an active account', function () {
    $founder = User::factory()->create();
    $crew = crewMake($founder);
    User::factory()->suspended()->create(['username' => 'gesperrt.erbe']);
    crewAdd($crew, User::query()->where('username', 'gesperrt.erbe')->firstOrFail());

    Sanctum::actingAs($founder);
    $this->postJson("/api/v1/crews/{$crew->slug}/founder", ['username' => 'gesperrt.erbe'])->assertUnprocessable()->assertJsonValidationErrors('username');
});

it('nit 9: deleting a crew takes the members\' "approved" notification rows with it', function () {
    $founder = User::factory()->create();
    $crew = crewMake($founder, [], CrewJoinMode::Request);
    $me = User::factory()->create();
    $request = CrewRequest::factory()->create(['crew_id' => $crew->id, 'user_id' => $me->id]);
    Sanctum::actingAs($founder);
    $this->postJson("/api/v1/crews/{$crew->slug}/requests/{$request->id}/approve")->assertCreated();
    expect(Notification::query()->where('notifiable_id', $me->id)->where('type', 'crew')->count())->toBe(1);

    $this->deleteJson("/api/v1/crews/{$crew->slug}", ['confirm_name' => $crew->name])->assertNoContent();
    expect(Notification::query()->where('notifiable_id', $me->id)->where('type', 'crew')->count())->toBe(0);
});
