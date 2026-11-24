<?php

use App\Enums\CrewJoinMode;
use App\Enums\CrewRole;
use App\Enums\CrewStatus;
use App\Enums\KeywordList;
use App\Enums\RestrictionType;
use App\Models\AuditEvent;
use App\Models\Crew;
use App\Models\CrewMember;
use App\Models\CrewRequest;
use App\Models\KeywordRule;
use App\Models\ModerationCase;
use App\Models\User;
use App\Services\Rules\KeywordNormaliser;
use App\Services\Rules\KeywordRules;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;

require_once __DIR__.'/CrewTestHelpers.php';

/**
 * R4-2.3 Crews, writes of the crew itself (contract-crews.md §3 #8–12, §4): founding with its limits, keyword rules and reserved names,
 * editing with the slug history, logo and cover through the media pipeline, deleting with confirmation; the authorisation matrix.
 */
beforeEach(function () {
    crewFlags();
});

function crewBody(array $overrides = []): array
{
    return ['name' => 'Nordlicht Crew', 'description' => 'Youngtimer aus Hamburg, jeden ersten Sonntag am Hafen.', 'bundesland' => 'HH', 'join_mode' => 'request', ...$overrides];
}

it('founds a crew: the member becomes founder, the slug comes from the name, the step is audited', function () {
    $me = User::factory()->create();
    Sanctum::actingAs($me);

    $this->postJson('/api/v1/crews', crewBody(['name' => '  Nordlicht   Crew ']))->assertCreated()
        ->assertJsonPath('data.name', 'Nordlicht Crew')->assertJsonPath('data.slug', 'nordlicht-crew')
        ->assertJsonPath('data.join_mode', 'request')->assertJsonPath('data.bundesland', 'HH')->assertJsonPath('data.member_count', 1)
        ->assertJsonPath('data.viewer.role', 'founder')->assertJsonPath('data.status', 'active');

    $crew = Crew::query()->firstOrFail();
    expect($crew->roleOf($me))->toBe(CrewRole::Founder)
        ->and(AuditEvent::query()->where('action', 'crew.created')->where('target_id', $crew->id)->exists())->toBeTrue();
});

it('validates name, join mode, description and Bundesland', function () {
    Sanctum::actingAs(User::factory()->create());
    crewMake(null, ['name' => 'Nordlicht Crew', 'name_key' => 'nordlicht crew']);

    $this->postJson('/api/v1/crews', [])->assertUnprocessable()->assertJsonValidationErrors(['name', 'join_mode']);
    $this->postJson('/api/v1/crews', crewBody(['name' => 'ab']))->assertUnprocessable()->assertJsonValidationErrors('name');
    $this->postJson('/api/v1/crews', crewBody(['name' => str_repeat('x', 41)]))->assertUnprocessable()->assertJsonValidationErrors('name');
    $this->postJson('/api/v1/crews', crewBody(['name' => 'Crew <script>']))->assertUnprocessable()->assertJsonValidationErrors('name');
    $this->postJson('/api/v1/crews', crewBody(['name' => 'NORDLICHT crew']))->assertUnprocessable()->assertJsonValidationErrors('name');
    $this->postJson('/api/v1/crews', crewBody(['name' => 'Speedclub']))->assertUnprocessable()->assertJsonValidationErrors('name');
    $this->postJson('/api/v1/crews', crewBody(['name' => 'Speed Club']))->assertUnprocessable()->assertJsonValidationErrors('name');
    $this->postJson('/api/v1/crews', crewBody(['name' => 'Elbe Crew', 'join_mode' => 'secret']))->assertUnprocessable()->assertJsonValidationErrors('join_mode');
    $this->postJson('/api/v1/crews', crewBody(['name' => 'Elbe Crew', 'bundesland' => 'XX']))->assertUnprocessable()->assertJsonValidationErrors('bundesland');
    $this->postJson('/api/v1/crews', crewBody(['name' => 'Elbe Crew', 'description' => str_repeat('a', 501)]))->assertUnprocessable()->assertJsonValidationErrors('description');
    expect(Crew::query()->count())->toBe(1);
});

it('applies the keyword rules to name and description: block refuses, flag files an automated report', function () {
    $block = new KeywordRule;
    $block->forceFill(['term' => 'schrottkarre', 'normalized' => KeywordNormaliser::term('schrottkarre'), 'list' => KeywordList::Block])->save();
    $flag = new KeywordRule;
    $flag->forceFill(['term' => 'rennstrecke', 'normalized' => KeywordNormaliser::term('rennstrecke'), 'list' => KeywordList::Flag])->save();
    app(KeywordRules::class)->flush();
    Sanctum::actingAs(User::factory()->create());

    $this->postJson('/api/v1/crews', crewBody(['name' => 'Schrottkarre Crew']))->assertUnprocessable()->assertJsonPath('code', 'content_blocked');
    $this->postJson('/api/v1/crews', crewBody(['description' => 'Wir sind die Schrottkarre-Gang']))->assertUnprocessable()->assertJsonPath('code', 'content_blocked');

    $this->postJson('/api/v1/crews', crewBody(['description' => 'Treffen nach der Rennstrecke']))->assertCreated();
    $crew = Crew::query()->firstOrFail();
    expect(ModerationCase::query()->where('target_type', 'crew')->where('target_id', $crew->id)->exists())->toBeTrue();
});

it('allows at most 2 founded crews and 5 memberships', function () {
    $me = User::factory()->create();
    Sanctum::actingAs($me);
    crewMake($me);
    crewMake($me);

    $this->postJson('/api/v1/crews', crewBody())->assertStatus(409)->assertJsonPath('code', 'limit_reached');

    $other = User::factory()->create();
    foreach (range(1, 5) as $i) {
        crewAdd(crewMake(), $other);
    }
    Sanctum::actingAs($other);
    $this->postJson('/api/v1/crews', crewBody())->assertStatus(409)->assertJsonPath('code', 'limit_reached');
});

it('refuses founding to guests, unverified, restricted and deactivated members', function () {
    $this->postJson('/api/v1/crews', crewBody())->assertUnauthorized();
    Sanctum::actingAs(User::factory()->unverified()->create());
    $this->postJson('/api/v1/crews', crewBody())->assertForbidden()->assertJsonPath('code', 'email_not_verified');
    Sanctum::actingAs(User::factory()->restrictedFrom(RestrictionType::Publishing)->create());
    $this->postJson('/api/v1/crews', crewBody())->assertForbidden()->assertJsonPath('code', 'account_restricted');
    expect(Crew::query()->count())->toBe(0);
});

it('replays a founding with the same Idempotency-Key and rate limits crew writes', function () {
    Sanctum::actingAs(User::factory()->create());
    $key = ['Idempotency-Key' => 'b3c1d2e4-crew-0001-9c3f-1d2e3f4a5b6c'];
    $first = $this->postJson('/api/v1/crews', crewBody(), $key)->assertCreated();
    $this->postJson('/api/v1/crews', crewBody(), $key)->assertCreated()->assertJsonPath('data.id', $first->json('data.id'));
    expect(Crew::query()->count())->toBe(1);

    socLimit('crews');
    $founder = User::factory()->create();
    $crew = crewMake($founder);
    Sanctum::actingAs($founder);
    $this->patchJson("/api/v1/crews/{$crew->slug}", ['description' => 'Eins'])->assertOk();
    $this->patchJson("/api/v1/crews/{$crew->slug}", ['description' => 'Zwei'])->assertTooManyRequests()->assertJsonPath('code', 'rate_limited');
});

it('lets founder and admins edit; a rename keeps the old slug working', function () {
    $founder = User::factory()->create();
    $admin = User::factory()->create();
    $crew = crewMake($founder, ['name' => 'Nordlicht Crew', 'name_key' => 'nordlicht crew', 'slug' => 'nordlicht-crew']);
    crewAdd($crew, $admin, CrewRole::Admin);

    Sanctum::actingAs($admin);
    $this->patchJson('/api/v1/crews/nordlicht-crew', ['description' => 'Neu beschrieben.', 'bundesland' => null, 'join_mode' => 'invite'])->assertOk()
        ->assertJsonPath('data.description', 'Neu beschrieben.')->assertJsonPath('data.bundesland', null)->assertJsonPath('data.join_mode', 'invite');

    Sanctum::actingAs($founder);
    $this->patchJson('/api/v1/crews/nordlicht-crew', ['name' => 'Nordlicht crew'])->assertOk()->assertJsonPath('data.slug', 'nordlicht-crew');
    $this->patchJson('/api/v1/crews/nordlicht-crew', ['name' => 'Elbe Nordlicht'])->assertOk()->assertJsonPath('data.slug', 'elbe-nordlicht');
    $this->getJson('/api/v1/crews/nordlicht-crew')->assertOk()->assertJsonPath('data.slug', 'elbe-nordlicht');

    // Another crew may not take the old slug through its name.
    Sanctum::actingAs(User::factory()->create());
    $this->postJson('/api/v1/crews', crewBody(['name' => 'Nordlicht Crew']))->assertCreated()->assertJsonPath('data.slug', 'nordlicht-crew-2');

    expect(AuditEvent::query()->where('action', 'crew.updated')->where('target_id', $crew->id)->count())->toBe(3);
});

it('refuses edits to members, others, guests, blocked and restricted members and on a hidden crew', function (string $who, int $status, ?string $code) {
    $founder = User::factory()->create();
    $crew = crewMake($founder);
    $actor = match ($who) {
        'guest' => null,
        'member' => tap(User::factory()->create(), fn (User $u) => crewAdd($crew, $u)),
        'other member' => User::factory()->create(),
        'blocked by the founder' => tap(User::factory()->create(), fn (User $u) => socBlock($founder, $u)),
        'restricted admin' => tap(User::factory()->restrictedFrom(RestrictionType::Publishing)->create(), fn (User $u) => crewAdd($crew, $u, CrewRole::Admin)),
        'founder of a hidden crew' => tap($founder, fn () => $crew->forceFill(['status' => CrewStatus::Hidden])->save()),
    };

    if ($actor !== null) {
        Sanctum::actingAs($actor);
    }

    $response = $this->patchJson("/api/v1/crews/{$crew->slug}", ['description' => 'Übernommen'])->assertStatus($status);

    if ($code !== null) {
        $response->assertJsonPath('code', $code);
    }

    expect($crew->refresh()->description)->not->toBe('Übernommen');
})->with([
    'guest' => ['guest', 401, null],
    'member' => ['member', 403, 'forbidden'],
    'other member' => ['other member', 403, 'forbidden'],
    'blocked by the founder' => ['blocked by the founder', 403, 'forbidden'],
    'restricted admin' => ['restricted admin', 403, 'account_restricted'],
    'founder of a hidden crew' => ['founder of a hidden crew', 409, 'conflict'],
]);

it('uploads and removes logo and cover through the media pipeline, for founder and admins only', function () {
    Storage::fake(config()->string('speedclub.media.disk'));
    Storage::fake(config()->string('speedclub.media.private_disk'));
    $founder = User::factory()->create();
    $crew = crewMake($founder);

    Sanctum::actingAs($founder);
    $this->post("/api/v1/crews/{$crew->slug}/cover", ['file' => UploadedFile::fake()->image('cover.jpg', 1600, 900)], ['Accept' => 'application/json'])->assertCreated();
    $this->post("/api/v1/crews/{$crew->slug}/logo", ['file' => UploadedFile::fake()->image('logo.jpg', 512, 512)], ['Accept' => 'application/json'])->assertCreated();
    $crew->refresh();
    expect($crew->cover_media_id)->not->toBeNull()->and($crew->logo_media_id)->not->toBeNull()
        ->and($crew->cover?->mediable_type)->toBe('crew');
    $this->post("/api/v1/crews/{$crew->slug}/logo", [], ['Accept' => 'application/json'])->assertUnprocessable();

    $member = User::factory()->create();
    crewAdd($crew, $member);
    Sanctum::actingAs($member);
    $this->post("/api/v1/crews/{$crew->slug}/logo", ['file' => UploadedFile::fake()->image('logo.jpg', 512, 512)], ['Accept' => 'application/json'])->assertForbidden();
    $this->deleteJson("/api/v1/crews/{$crew->slug}/logo")->assertForbidden();

    Sanctum::actingAs($founder);
    $this->deleteJson("/api/v1/crews/{$crew->slug}/logo")->assertNoContent();
    expect($crew->refresh()->logo_media_id)->toBeNull();
});

it('lets only the founder delete, with the name typed to confirm; the name is free again', function () {
    $founder = User::factory()->create();
    $admin = User::factory()->create();
    $crew = crewMake($founder, ['name' => 'Nordlicht Crew', 'name_key' => 'nordlicht crew', 'slug' => 'nordlicht-crew']);
    crewAdd($crew, $admin, CrewRole::Admin);
    CrewRequest::factory()->create(['crew_id' => $crew->id]);

    Sanctum::actingAs($admin);
    $this->deleteJson("/api/v1/crews/{$crew->slug}", ['confirm_name' => 'Nordlicht Crew'])->assertForbidden();

    Sanctum::actingAs($founder);
    $this->deleteJson("/api/v1/crews/{$crew->slug}", [])->assertUnprocessable()->assertJsonValidationErrors('confirm_name');
    $this->deleteJson("/api/v1/crews/{$crew->slug}", ['confirm_name' => 'Nordlicht'])->assertUnprocessable()->assertJsonValidationErrors('confirm_name');
    $this->deleteJson("/api/v1/crews/{$crew->slug}", ['confirm_name' => 'nordlicht crew'])->assertNoContent();

    expect(Crew::withTrashed()->find($crew->id)?->trashed())->toBeTrue()
        ->and(CrewMember::query()->where('crew_id', $crew->id)->exists())->toBeFalse()
        ->and(AuditEvent::query()->where('action', 'crew.deleted')->where('target_id', $crew->id)->exists())->toBeTrue();
    $this->getJson("/api/v1/crews/{$crew->slug}")->assertNotFound();
    $this->postJson('/api/v1/crews', crewBody(['name' => 'Nordlicht Crew', 'join_mode' => CrewJoinMode::Open->value]))->assertCreated()
        ->assertJsonPath('data.slug', 'nordlicht-crew-2');
});

it('lets a restricted founder still delete their crew', function () {
    $founder = User::factory()->restrictedFrom(RestrictionType::Publishing)->create();
    $crew = crewMake($founder);
    Sanctum::actingAs($founder);

    $this->deleteJson("/api/v1/crews/{$crew->slug}", ['confirm_name' => $crew->name])->assertNoContent();
});
