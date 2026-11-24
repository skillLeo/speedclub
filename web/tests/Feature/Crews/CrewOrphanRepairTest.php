<?php

use App\Actions\Auth\DeleteUnverifiedAccount;
use App\Enums\CrewEndReason;
use App\Enums\CrewRole;
use App\Models\AuditEvent;
use App\Models\Crew;
use App\Models\CrewInvite;
use App\Models\CrewMember;
use App\Models\CrewRequest;
use App\Models\User;
use App\Services\Crews\CrewRepair;
use Illuminate\Support\Facades\DB;

require_once __DIR__.'/CrewTestHelpers.php';

/**
 * R4DQ-21 (round-4 design review): crews of accounts that were hard-deleted outside DeleteAccount kept "Aktiv", their old count and no
 * founder. Every hard delete path now closes the account for its crews (C8), CrewRepair (run by 2027_01_13_100000) repairs what is
 * already broken, and the member-facing lists never show a crew without a live member.
 */
beforeEach(function () {
    crewFlags();
});

it('hands the crews of an unverified account over, ends a crew nobody is left in and recounts (C8 on the hard delete path)', function () {
    $closing = User::factory()->create();
    $admin = User::factory()->create();
    $member = User::factory()->create();
    $withAdmin = crewMake($closing, ['name' => 'Hafen Crew', 'name_key' => 'hafen crew']);
    crewAdd($withAdmin, $member)->forceFill(['joined_at' => now()->subDays(9)])->save();
    crewAdd($withAdmin, $admin, CrewRole::Admin)->forceFill(['joined_at' => now()->subDay()])->save();
    $alone = crewMake($closing, ['name' => 'Allein Crew', 'name_key' => 'allein crew']);
    $joined = crewMake($admin, ['name' => 'Andere Crew', 'name_key' => 'andere crew']);
    crewAdd($joined, $closing);

    app(DeleteUnverifiedAccount::class)->handle($closing);

    expect(User::withTrashed()->find($closing->id))->toBeNull()
        ->and($withAdmin->roleOf($admin))->toBe(CrewRole::Founder)
        ->and($withAdmin->refresh()->members_count)->toBe(2)
        ->and(Crew::withTrashed()->findOrFail($alone->id)->trashed())->toBeTrue()
        ->and(Crew::withTrashed()->findOrFail($alone->id)->ended_reason)->toBe(CrewEndReason::NoMembers)
        ->and(Crew::withTrashed()->findOrFail($withAdmin->id)->ended_reason)->toBeNull()
        ->and($joined->refresh()->members_count)->toBe(1)
        ->and(AuditEvent::query()->where('action', 'crew.founder_transferred')->where('target_id', $withAdmin->id)->exists())->toBeTrue();
});

it('repairs crews broken before: a founder from the oldest admin, else the oldest member, an end for an empty crew, a true count', function () {
    $admin = User::factory()->create(['username' => 'repair.admin']);
    $older = User::factory()->create(['username' => 'repair.older']);
    $noFounder = crewMake(null, ['name' => 'Ohne Gründer', 'name_key' => 'ohne gründer']);
    crewAdd($noFounder, $older)->forceFill(['joined_at' => now()->subDays(20)])->save();
    crewAdd($noFounder, $admin, CrewRole::Admin)->forceFill(['joined_at' => now()->subDays(2)])->save();
    $onlyMembers = crewMake(null, ['name' => 'Nur Mitglieder', 'name_key' => 'nur mitglieder']);
    $plain = User::factory()->create(['username' => 'repair.plain']);
    crewAdd($onlyMembers, $plain);
    $empty = crewMake(null, ['name' => 'Leere Crew', 'name_key' => 'leere crew']);
    $request = CrewRequest::factory()->create(['crew_id' => $empty->id]);
    CrewInvite::factory()->create(['crew_id' => $empty->id]);
    $stale = crewMake(null, ['name' => 'Alte Zahl', 'name_key' => 'alte zahl']);

    // As before C8 reached every path: the founders' accounts were hard-deleted (their rows cascaded), the counts stayed.
    foreach ([$noFounder, $onlyMembers, $empty] as $crew) {
        $founder = crewFounder($crew);
        DB::table('crew_members')->where('user_id', $founder->id)->delete();
        DB::table('users')->where('id', $founder->id)->delete();
    }
    Crew::query()->whereKey($stale->id)->toBase()->update(['members_count' => 7]);

    // A soft-deleted account that still holds a membership (it never went through DeleteAccount's crew step).
    $ghostFounder = User::factory()->create();
    $ghostCrew = crewMake($ghostFounder, ['name' => 'Geister Crew', 'name_key' => 'geister crew']);
    $heir = User::factory()->create(['username' => 'repair.heir']);
    crewAdd($ghostCrew, $heir);
    DB::table('users')->where('id', $ghostFounder->id)->update(['deleted_at' => now()]);

    $result = app(CrewRepair::class)->run();

    expect($result)->toMatchArray(['closed_accounts' => 1, 'founders' => 2, 'ended' => 1])
        ->and($noFounder->roleOf($admin))->toBe(CrewRole::Founder)
        ->and($noFounder->roleOf($older))->toBe(CrewRole::Member)
        ->and($noFounder->refresh()->members_count)->toBe(2)
        ->and($onlyMembers->roleOf($plain))->toBe(CrewRole::Founder)
        ->and($onlyMembers->refresh()->members_count)->toBe(1)
        ->and(Crew::withTrashed()->findOrFail($empty->id)->trashed())->toBeTrue()
        ->and(Crew::withTrashed()->findOrFail($empty->id)->name_key)->toBeNull()
        ->and(Crew::withTrashed()->findOrFail($empty->id)->members_count)->toBe(0)
        ->and(Crew::withTrashed()->findOrFail($empty->id)->ended_reason)->toBe(CrewEndReason::NoMembers)
        ->and(CrewRequest::query()->whereKey($request->id)->exists())->toBeFalse()
        ->and(CrewInvite::query()->where('crew_id', $empty->id)->exists())->toBeFalse()
        ->and($stale->refresh()->members_count)->toBe(1)
        ->and($ghostCrew->roleOf($heir))->toBe(CrewRole::Founder)
        ->and(CrewMember::query()->where('user_id', $ghostFounder->id)->exists())->toBeFalse()
        ->and($ghostCrew->refresh()->members_count)->toBe(1);

    $audit = AuditEvent::query()->where('action', 'crew.deleted')->where('target_id', $empty->id)->firstOrFail();
    expect($audit->reason)->toBe('repair')
        ->and(AuditEvent::query()->where('action', 'crew.founder_transferred')->where('target_id', $noFounder->id)->where('reason', 'repair')->exists())->toBeTrue();

    // Idempotent: a second run finds nothing to do.
    expect(app(CrewRepair::class)->run())->toBe(['closed_accounts' => 0, 'founders' => 0, 'ended' => 0, 'recounted' => 0]);
});

it('never lists a crew without a live member to members', function () {
    $live = crewMake(null, ['name' => 'Lebende Crew', 'name_key' => 'lebende crew']);
    $orphan = crewMake(null, ['name' => 'Verwaiste Crew', 'name_key' => 'verwaiste crew']);
    $gone = crewFounder($orphan);
    DB::table('users')->where('id', $gone->id)->update(['deleted_at' => now()]);

    $slugs = collect($this->getJson('/api/v1/crews')->assertOk()->json('data'))->pluck('slug')->all();

    expect($slugs)->toContain($live->slug)->not->toContain($orphan->slug);
});
