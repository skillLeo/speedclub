<?php

use App\Enums\MediaStatus;
use App\Enums\MemberSecurityEvent;
use App\Enums\RestrictionType;
use App\Enums\VehicleStatus;
use App\Enums\Visibility;
use App\Http\Resources\V1\MemberPublicResource;
use App\Models\Media;
use App\Models\Staff;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\Maintenance\MaintenancePrefs;
use App\Services\Notifications\NotificationPrefs;
use Illuminate\Http\Request;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use Tests\Support\TestImages;

beforeEach(function () {
    Mail::fake();
    Storage::fake('public');
    Storage::fake('local');
});

function jpegUpload(): array
{
    return ['file' => UploadedFile::fake()->createWithContent('a.jpg', TestImages::jpeg(400, 300))];
}

function postImage(string $slot, ?array $body = null, array $headers = []): mixed
{
    return test()->post("/api/v1/me/$slot", $body ?? jpegUpload(), ['Accept' => 'application/json', ...$headers]);
}

/**
 * Who may reach a profile write, and how each of the others is stopped.
 *
 * @return array<string, array{0: Closure(): void, 1: int, 2: string|null}>
 */
function profileWriteMatrix(): array
{
    return [
        'guest' => [fn () => null, 401, 'unauthenticated'],
        'owner' => [fn () => Sanctum::actingAs(User::factory()->create()), 200, null],
        'unverified' => [fn () => Sanctum::actingAs(User::factory()->registered()->create()), 200, null],
        'restricted' => [fn () => Sanctum::actingAs(User::factory()->restrictedFrom(RestrictionType::Publishing)->create()), 403, 'account_restricted'],
        'suspended' => [fn () => Sanctum::actingAs(User::factory()->suspended()->create()), 403, 'account_restricted'],
        'deactivated' => [fn () => Sanctum::actingAs(User::factory()->deactivated()->create()), 403, 'forbidden'],
        'restricted from messaging only' => [fn () => Sanctum::actingAs(User::factory()->restrictedFrom(RestrictionType::Messaging)->create()), 200, null],
        'staff session' => [fn () => test()->withCredentials()->withCookie('sc_staff_session', databaseSessionFor(Staff::factory()->create(), 'staff'))->withHeader('Origin', 'http://localhost:8080'), 401, 'unauthenticated'],
    ];
}

describe('GET usernames/check', function () {
    it('reports available', function () {
        $this->getJson('/api/v1/usernames/check?username=Lukas.SC')
            ->assertOk()
            ->assertExactJson(['data' => ['username' => 'lukas.sc', 'available' => true, 'reason' => null]]);
    });

    it('gives a reason code for what cannot be used', function (string $username, string $reason) {
        $this->getJson('/api/v1/usernames/check?username='.urlencode($username))
            ->assertOk()
            ->assertJsonPath('data.available', false)
            ->assertJsonPath('data.reason', $reason);
    })->with([
        ['ab', 'length'],
        [str_repeat('a', 25), 'length'],
        ['lukas sc', 'characters'],
        ['_lukas', 'start'],
        ['lukas.', 'trailing_dot'],
        ['lu..kas', 'consecutive_dots'],
        ['admin', 'reserved'],
        ['SpeedClub', 'reserved'],
    ]);

    it('is case-insensitive for names in use', function () {
        User::factory()->create(['username' => 'lukas.sc']);

        $this->getJson('/api/v1/usernames/check?username=LUKAS.sc')->assertJsonPath('data.reason', 'taken');
    });

    it('reads a deleted account and a recent old name as taken, and says no more', function () {
        User::factory()->create(['username' => 'geloescht'])->delete();
        User::factory()->create(['username' => 'neuername'])->forceFill(['previous_username' => 'altername', 'username_changed_at' => now()->subDays(13)])->save();

        $this->getJson('/api/v1/usernames/check?username=geloescht')->assertJsonPath('data.reason', 'taken');
        $this->getJson('/api/v1/usernames/check?username=altername')->assertJsonPath('data.reason', 'taken');
    });

    it('frees an old name after 14 days', function () {
        User::factory()->create(['username' => 'neuername'])->forceFill(['previous_username' => 'altername', 'username_changed_at' => now()->subDays(15)])->save();

        $this->getJson('/api/v1/usernames/check?username=altername')->assertJsonPath('data.available', true);
    });

    it('counts the own name as available when signed in', function () {
        $member = User::factory()->create(['username' => 'meinname']);

        Sanctum::actingAs($member);

        $this->getJson('/api/v1/usernames/check?username=meinname')->assertJsonPath('data.available', true);
    });

    it('needs a value', function () {
        $this->getJson('/api/v1/usernames/check')->assertUnprocessable()->assertJsonValidationErrors('username');
    });

    it('is rate limited', function () {
        foreach (range(1, 60) as $round) {
            $this->getJson('/api/v1/usernames/check?username=lukas')->assertOk();
        }

        $this->getJson('/api/v1/usernames/check?username=lukas')->assertStatus(429)->assertJsonPath('code', 'rate_limited');
    });
});

describe('PUT me/username', function () {
    it('sets the first username without a cooldown and without an old name', function () {
        $member = User::factory()->registered()->create();
        Sanctum::actingAs($member);

        $this->putJson('/api/v1/me/username', ['username' => 'Lukas.SC'])
            ->assertOk()
            ->assertJsonPath('data.username', 'lukas.sc')
            ->assertJsonPath('data.has_username', true)
            ->assertJsonPath('data.username_change_available_at', null);

        $member->refresh();

        expect($member->previous_username)->toBeNull()
            ->and($member->username_changed_at)->toBeNull();

        $this->assertDatabaseHas('audit_events', ['action' => MemberSecurityEvent::UsernameChanged->value, 'actor_id' => $member->id]);
    });

    it('changes it after the first choice, keeps the old name and starts the cooldown', function () {
        $member = User::factory()->create(['username' => 'altername']);
        Sanctum::actingAs($member);

        $this->putJson('/api/v1/me/username', ['username' => 'neuername'])
            ->assertOk()
            ->assertJsonPath('data.username', 'neuername');

        $member->refresh();

        expect($member->previous_username)->toBe('altername')
            ->and($member->username_changed_at)->not->toBeNull();

        $this->putJson('/api/v1/me/username', ['username' => 'nochanders'])
            ->assertStatus(409)
            ->assertJsonPath('code', 'username_change_cooldown')
            ->assertJsonStructure(['until']);

        $this->travel(31)->days();

        $this->putJson('/api/v1/me/username', ['username' => 'nochanders'])->assertOk();
    });

    it('treats the current name as nothing to do', function () {
        $member = User::factory()->create(['username' => 'meinname']);
        Sanctum::actingAs($member);

        $this->putJson('/api/v1/me/username', ['username' => 'MEINNAME'])->assertOk();

        expect($member->refresh()->username_changed_at)->toBeNull();
    });

    it('refuses a name in use, an old name and a reserved one', function (string $username) {
        User::factory()->create(['username' => 'vergeben']);
        User::factory()->create(['username' => 'andere'])->forceFill(['previous_username' => 'alt.name', 'username_changed_at' => now()])->save();
        Sanctum::actingAs(User::factory()->registered()->create());

        $this->putJson('/api/v1/me/username', ['username' => $username])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('username');
    })->with(['VERGEBEN', 'alt.name', 'admin', '.punkt', 'a']);

    it('refuses the password as a username', function () {
        Sanctum::actingAs(User::factory()->registered()->create(['password' => 'mein.passwort.1']));

        $this->putJson('/api/v1/me/username', ['username' => 'mein.passwort.1'])
            ->assertUnprocessable()
            ->assertJsonFragment([__('username.same_as_password')]);
    });

    it('applies the authorisation matrix', function (Closure $as, int $status, ?string $code) {
        $as();

        $response = $this->putJson('/api/v1/me/username', ['username' => 'freiername'])->assertStatus($status);

        if ($code !== null) {
            $response->assertJsonPath('code', $code);
        }
    })->with(profileWriteMatrix());

    it('changes only the signed-in member', function () {
        $other = User::factory()->create(['username' => 'anderer']);
        Sanctum::actingAs(User::factory()->create());

        $this->putJson('/api/v1/me/username', ['username' => 'freiername', 'id' => $other->id])->assertOk();

        expect($other->refresh()->username)->toBe('anderer');
    });
});

describe('me/profile', function () {
    it('returns the exact shape on GET', function () {
        Sanctum::actingAs(User::factory()->create());

        $this->getJson('/api/v1/me/profile')
            ->assertOk()
            ->assertExactJsonStructure(['data' => [
                'id', 'email', 'email_verified', 'has_username', 'profile_complete', 'next_step', 'force_password_change',
                'username', 'username_change_available_at', 'display_name', 'city', 'bio', 'avatar', 'cover', 'locale', 'theme',
                'power_display', 'member_since',
                'stats' => ['vehicles', 'followers', 'following'],
                'is_sample', 'is_editorial',
                'two_factor_enabled',
                // M4.6: false for a passwordless account.
                'password_set',
                'restrictions' => [
                    'suspended',
                    'messaging' => ['restricted', 'until', 'decision_id'],
                    'publishing' => ['restricted', 'until', 'decision_id'],
                ],
            ]]);
    });

    it('updates only the fields sent', function () {
        Sanctum::actingAs(User::factory()->create(['display_name' => 'Alt', 'city' => 'Berlin', 'bio' => null]));

        $this->patchJson('/api/v1/me/profile', ['display_name' => 'Lukas', 'bio' => 'R34 seit 2019'])
            ->assertOk()
            ->assertJsonPath('data.display_name', 'Lukas')
            ->assertJsonPath('data.city', 'Berlin')
            ->assertJsonPath('data.bio', 'R34 seit 2019');
    });

    it('clears a field with null', function () {
        Sanctum::actingAs(User::factory()->create(['city' => 'Berlin']));

        $this->patchJson('/api/v1/me/profile', ['city' => null])->assertOk()->assertJsonPath('data.city', null);
    });

    it('ends the profile step with an empty PATCH, so it can be skipped', function () {
        Sanctum::actingAs(User::factory()->registered()->create(['email_verified_at' => now(), 'username' => 'lukas']));

        $this->getJson('/api/v1/me/profile')->assertJsonPath('data.next_step', 'profile_setup')->assertJsonPath('data.profile_complete', false);

        $this->patchJson('/api/v1/me/profile', [])->assertOk()->assertJsonPath('data.next_step', null)->assertJsonPath('data.profile_complete', true);
    });

    it('validates the limits', function (array $body, string $field) {
        Sanctum::actingAs(User::factory()->create());

        $this->patchJson('/api/v1/me/profile', $body)->assertUnprocessable()->assertJsonValidationErrors($field);
    })->with([
        [['display_name' => str_repeat('x', 61)], 'display_name'],
        [['city' => str_repeat('x', 101)], 'city'],
        [['bio' => str_repeat('x', 501)], 'bio'],
        [['bio' => ['a']], 'bio'],
    ]);

    it('ignores fields outside the form', function () {
        $member = User::factory()->create();
        Sanctum::actingAs($member);

        $this->patchJson('/api/v1/me/profile', ['status' => 'suspended', 'email_verified_at' => null, 'email' => 'x@example.de'])->assertOk();

        expect($member->refresh()->status->value)->toBe('active')
            ->and($member->email_verified_at)->not->toBeNull()
            ->and($member->email)->not->toBe('x@example.de');
    });

    it('applies the authorisation matrix on PATCH', function (Closure $as, int $status, ?string $code) {
        $as();

        $response = $this->patchJson('/api/v1/me/profile', ['display_name' => 'Name'])->assertStatus($status);

        if ($code !== null) {
            $response->assertJsonPath('code', $code);
        }
    })->with(profileWriteMatrix());

    it('lets a restricted or suspended member read the profile, but not a guest', function () {
        $this->getJson('/api/v1/me/profile')->assertUnauthorized();

        Sanctum::actingAs(User::factory()->suspended()->create());

        $this->getJson('/api/v1/me/profile')->assertOk();
    });
});

describe('error texts', function () {
    it('names the profile and settings fields in both languages', function (string $locale, string $path, array $body, string $field, string $message) {
        Sanctum::actingAs(User::factory()->create());

        $this->withHeader('Accept-Language', $locale)
            ->patchJson($path, $body)
            ->assertUnprocessable()
            ->assertJsonPath("errors.$field", [$message]);
    })->with([
        ['de', '/api/v1/me/profile', ['display_name' => str_repeat('x', 61)], 'display_name', 'Anzeigename darf maximal 60 Zeichen haben.'],
        ['de', '/api/v1/me/profile', ['bio' => str_repeat('x', 501)], 'bio', 'Bio darf maximal 500 Zeichen haben.'],
        ['de', '/api/v1/me/settings', ['theme' => 'neon'], 'theme', 'Der ausgewählte Wert ist ungültig.'],
        ['de', '/api/v1/me/settings', ['locale' => 'fr'], 'locale', 'Der gewählte Wert für Sprache ist ungültig.'],
        ['de', '/api/v1/me/settings', ['power_display' => 'x'], 'power_display', 'Der ausgewählte Wert ist ungültig.'],
        ['en', '/api/v1/me/profile', ['display_name' => str_repeat('x', 61)], 'display_name', 'The display name field must not be greater than 60 characters.'],
        ['en', '/api/v1/me/settings', ['locale' => 'fr'], 'locale', 'The selected language is invalid.'],
        ['de', '/api/v1/me/settings', ['show_owner_on_qr' => 'nein'], 'show_owner_on_qr', 'Besitzer auf der QR-Seite muss an oder aus sein.'],
        ['en', '/api/v1/me/settings', ['show_owner_on_qr' => 'no'], 'show_owner_on_qr', 'The owner on the QR page field must be on or off.'],
    ]);
});

describe('real stats', function () {
    beforeEach(function () {
        $this->member = User::factory()->create();

        Vehicle::factory()->create(['owner_id' => $this->member->id, 'status' => VehicleStatus::Published, 'visibility' => Visibility::Public]);
        Vehicle::factory()->create(['owner_id' => $this->member->id, 'status' => VehicleStatus::Published, 'visibility' => Visibility::Private]);
        Vehicle::factory()->create(['owner_id' => $this->member->id, 'status' => VehicleStatus::Published, 'visibility' => Visibility::Unlisted]);
        Vehicle::factory()->create(['owner_id' => $this->member->id, 'status' => VehicleStatus::Draft, 'visibility' => Visibility::Public]);
        Vehicle::factory()->create(['owner_id' => $this->member->id, 'status' => VehicleStatus::Published, 'visibility' => Visibility::Public])->delete();

        [$one, $two, $gone] = User::factory()->count(3)->create();
        $this->member->followers()->attach([$one->id => ['created_at' => now()], $two->id => ['created_at' => now()], $gone->id => ['created_at' => now()]]);
        $this->member->following()->attach([$one->id => ['created_at' => now()]]);
        $gone->delete();
    });

    it('counts for the owner', function () {
        Sanctum::actingAs($this->member);

        $this->getJson('/api/v1/auth/me')->assertJsonPath('data.stats', ['vehicles' => 3, 'followers' => 2, 'following' => 1]);
    });

    it('counts for others in the public resource, which holds nothing private', function () {
        $public = (new MemberPublicResource($this->member))->resolve(new Request);

        expect(array_keys($public))->toBe(['username', 'display_name', 'city', 'bio', 'avatar', 'cover', 'member_since', 'stats', 'is_sample', 'is_editorial'])
            ->and($public['stats'])->toBe(['vehicles' => 1, 'followers' => 2, 'following' => 1]);
    });
});

describe('POST me/avatar and me/cover', function () {
    it('stores the image through the pipeline and returns the member', function (string $slot, string $field, string $column) {
        $member = User::factory()->create();
        Sanctum::actingAs($member);

        $response = postImage($slot)->assertOk();

        $media = Media::query()->findOrFail($member->refresh()->getAttribute($column));

        expect($media->status)->toBe(MediaStatus::Ready)
            ->and($media->owner_id)->toBe($member->id)
            ->and($media->mediable_type)->toBe('user');

        $response->assertJsonPath("data.$field.id", $media->id)
            ->assertJsonPath("data.$field.status", 'ready')
            ->assertJsonPath("data.$field.width", 400);

        expect($response->json("data.$field.variants"))->not->toBeEmpty();
    })->with([
        ['avatar', 'avatar', 'avatar_media_id'],
        ['cover', 'cover', 'cover_media_id'],
    ]);

    it('replaces the old image through the delete path', function () {
        $member = User::factory()->create();
        Sanctum::actingAs($member);

        postImage('avatar')->assertOk();
        $old = Media::query()->findOrFail($member->refresh()->avatar_media_id);

        expect(Storage::disk('public')->allFiles('media/'.strtolower($old->id)))->not->toBeEmpty();

        postImage('avatar')->assertOk();

        expect($member->refresh()->avatar_media_id)->not->toBe($old->id)->not->toBeNull()
            ->and(Media::withTrashed()->findOrFail($old->id)->trashed())->toBeTrue()
            ->and(Storage::disk('public')->allFiles('media/'.strtolower($old->id)))->toBe([])
            ->and(Media::query()->count())->toBe(1);
    });

    it('keeps the old image when the new file is rejected', function () {
        $member = User::factory()->create();
        Sanctum::actingAs($member);

        postImage('avatar')->assertOk();
        $old = $member->refresh()->avatar_media_id;

        postImage('avatar', ['file' => UploadedFile::fake()->createWithContent('a.jpg', 'kein bild')])
            ->assertStatus(415)
            ->assertJsonPath('code', 'unsupported_media_type');

        expect($member->refresh()->avatar_media_id)->toBe($old);
    });

    it('replays with the same Idempotency-Key', function () {
        $member = User::factory()->create();
        Sanctum::actingAs($member);
        $body = jpegUpload();

        $first = postImage('avatar', $body, ['Idempotency-Key' => 'avatar-1'])->assertOk();

        postImage('avatar', $body, ['Idempotency-Key' => 'avatar-1'])
            ->assertOk()
            ->assertHeader('Idempotency-Replayed', 'true')
            ->assertJsonPath('data.avatar.id', $first->json('data.avatar.id'));

        expect(Media::query()->count())->toBe(1);
    });

    it('needs a file', function () {
        Sanctum::actingAs(User::factory()->create());

        postImage('avatar', [])->assertUnprocessable()->assertJsonValidationErrors('file');
    });

    it('shares the upload limit', function () {
        $member = User::factory()->create();
        Sanctum::actingAs($member);

        $limit = RateLimiter::limiter('uploads')(tap(Request::create('/'), fn (Request $request) => $request->setUserResolver(fn () => $member)));
        RateLimiter::increment(md5('uploads'.$limit->key), 3600, 60);

        postImage('cover')->assertStatus(429)->assertJsonPath('code', 'rate_limited');
    });

    it('applies the authorisation matrix', function (Closure $as, int $status, ?string $code) {
        $as();

        $response = postImage('avatar')->assertStatus($status);

        if ($code !== null) {
            $response->assertJsonPath('code', $code);
        }
    })->with(profileWriteMatrix());
});

describe('me/settings', function () {
    it('returns the exact shape', function () {
        Sanctum::actingAs(User::factory()->create()->refresh());

        $this->getJson('/api/v1/me/settings')
            ->assertOk()
            ->assertExactJson(['data' => ['theme' => 'carbon', 'locale' => 'de', 'effective_locale' => 'de', 'home_region' => null, 'power_display' => 'ps_kw', 'distance_unit' => 'km', 'torque_unit' => 'nm', 'weight_unit' => 'kg', 'maintenance' => MaintenancePrefs::DEFAULTS, 'show_owner_on_qr' => true, 'who_can_message' => 'everyone', 'mention_privacy' => 'everyone', 'discoverable' => true, 'indexable' => true, 'read_receipts' => true, 'ai_suggestions' => false, 'notification_prefs' => NotificationPrefs::defaults()]]);
    });

    it('updates what is sent', function () {
        Sanctum::actingAs(User::factory()->create());

        $this->patchJson('/api/v1/me/settings', ['theme' => 'light', 'locale' => 'en', 'power_display' => 'hp'])
            ->assertOk()
            ->assertExactJson(['data' => ['theme' => 'light', 'locale' => 'en', 'effective_locale' => 'en', 'home_region' => null, 'power_display' => 'hp', 'distance_unit' => 'km', 'torque_unit' => 'nm', 'weight_unit' => 'kg', 'maintenance' => MaintenancePrefs::DEFAULTS, 'show_owner_on_qr' => true, 'who_can_message' => 'everyone', 'mention_privacy' => 'everyone', 'discoverable' => true, 'indexable' => true, 'read_receipts' => true, 'ai_suggestions' => false, 'notification_prefs' => NotificationPrefs::defaults()]]);

        $this->patchJson('/api/v1/me/settings', ['theme' => 'black'])
            ->assertOk()
            ->assertJsonPath('data.locale', 'en');
    });

    it('saves whether sticker pages name the owner, and only that when only that is sent', function () {
        $member = User::factory()->create(['theme' => 'light', 'locale' => 'en', 'power_display' => 'hp']);
        Sanctum::actingAs($member);

        $this->patchJson('/api/v1/me/settings', ['show_owner_on_qr' => false])
            ->assertOk()
            ->assertExactJson(['data' => ['theme' => 'light', 'locale' => 'en', 'effective_locale' => 'en', 'home_region' => null, 'power_display' => 'hp', 'distance_unit' => 'km', 'torque_unit' => 'nm', 'weight_unit' => 'kg', 'maintenance' => MaintenancePrefs::DEFAULTS, 'show_owner_on_qr' => false, 'who_can_message' => 'everyone', 'mention_privacy' => 'everyone', 'discoverable' => true, 'indexable' => true, 'read_receipts' => true, 'ai_suggestions' => false, 'notification_prefs' => NotificationPrefs::defaults()]]);

        expect($member->refresh()->getAttribute('show_owner_on_qr'))->toBeFalse();

        $this->getJson('/api/v1/me/settings')->assertOk()->assertJsonPath('data.show_owner_on_qr', false);

        $this->patchJson('/api/v1/me/settings', ['show_owner_on_qr' => true])
            ->assertOk()
            ->assertJsonPath('data.show_owner_on_qr', true);

        expect($member->refresh()->getAttribute('show_owner_on_qr'))->toBeTrue();
    });

    it('hides the owner of every one of their vehicles from everybody else once switched off', function () {
        $owner = User::factory()->create(['username' => 'lukas.sc']);
        [$first, $second] = Vehicle::factory()->published()->count(2)->create(['owner_id' => $owner->id])->all();

        foreach ([$first, $second] as $vehicle) {
            Media::factory()->forModel($vehicle)->create(['owner_id' => $owner->id]);
        }
        Sanctum::actingAs($owner);

        $this->patchJson('/api/v1/me/settings', ['show_owner_on_qr' => false])->assertOk();

        foreach ([$first, $second] as $vehicle) {
            $this->getJson('/api/v1/public/vehicles/'.$vehicle->canonicalSlug())->assertOk()
                ->assertJsonPath('data.owner.username', 'lukas.sc');
        }

        app('auth')->forgetGuards();
        Sanctum::actingAs(User::factory()->create());

        foreach ([$first, $second] as $vehicle) {
            $this->getJson('/api/v1/public/vehicles/'.$vehicle->canonicalSlug())->assertOk()
                ->assertJsonPath('data.owner', null);
        }

        app('auth')->forgetGuards();

        $guest = $this->getJson('/api/v1/public/vehicles/'.$first->canonicalSlug())->assertOk();

        expect($guest->json('data.owner'))->toBeNull()
            ->and($guest->getContent())->not->toContain('lukas.sc');
    });

    it('takes only a JSON boolean for show_owner_on_qr', function (mixed $value) {
        $member = User::factory()->create();
        Sanctum::actingAs($member);

        $this->patchJson('/api/v1/me/settings', ['show_owner_on_qr' => $value])
            ->assertUnprocessable()
            ->assertJsonPath('code', 'validation_failed')
            ->assertJsonValidationErrors('show_owner_on_qr');

        expect($member->refresh()->getAttribute('show_owner_on_qr'))->toBeTrue();
    })->with([
        'null' => [null],
        'string' => ['false'],
        'one' => [1],
        'zero as string' => ['0'],
        'array' => [[false]],
    ]);

    it('lets only the signed-in member change their own show_owner_on_qr', function (Closure $actor, int $status, ?string $code) {
        $member = User::factory()->create();
        $bystander = User::factory()->create();
        $acting = $actor($member);

        $response = $this->patchJson('/api/v1/me/settings', ['show_owner_on_qr' => false])->assertStatus($status);

        if ($code !== null) {
            $response->assertJsonPath('code', $code);
        }

        expect($bystander->refresh()->getAttribute('show_owner_on_qr'))->toBeTrue();

        if ($acting instanceof User) {
            expect($acting->refresh()->getAttribute('show_owner_on_qr'))->toBe($status !== 200);
        }
    })->with([
        'guest' => [fn () => null, 401, 'unauthenticated'],
        'owner' => [fn (User $member) => Sanctum::actingAs($member), 200, null],
        'another member, who only changes their own' => [fn () => Sanctum::actingAs(User::factory()->create()), 200, null],
        'unverified' => [fn () => Sanctum::actingAs(User::factory()->registered()->create()), 200, null],
        'restricted from publishing' => [fn () => Sanctum::actingAs(User::factory()->restrictedFrom(RestrictionType::Publishing)->create()), 200, null],
        'suspended' => [fn () => Sanctum::actingAs(User::factory()->suspended()->create()), 200, null],
        'deactivated' => [fn () => Sanctum::actingAs(User::factory()->deactivated()->create()), 403, 'forbidden'],
        'password change required' => [fn () => Sanctum::actingAs(User::factory()->create(['force_password_change' => true])), 403, 'password_change_required'],
        'staff session' => [fn () => test()->withCredentials()->withCookie('sc_staff_session', databaseSessionFor(Staff::factory()->create(), 'staff'))->withHeader('Origin', 'http://localhost:8080'), 401, 'unauthenticated'],
    ]);

    it('validates', function (array $body, string $field) {
        Sanctum::actingAs(User::factory()->create());

        $this->patchJson('/api/v1/me/settings', $body)->assertUnprocessable()->assertJsonValidationErrors($field);
    })->with([
        [['theme' => 'pink'], 'theme'],
        [['locale' => 'fr'], 'locale'],
        [['power_display' => 'bhp'], 'power_display'],
    ]);

    it('stays open to a restricted, a suspended and an unverified member', function (Closure $factory) {
        Sanctum::actingAs($factory());

        $this->patchJson('/api/v1/me/settings', ['theme' => 'light'])->assertOk();
    })->with([
        'restricted' => [fn () => User::factory()->restrictedFrom(RestrictionType::Publishing)->create()],
        'suspended' => [fn () => User::factory()->suspended()->create()],
        'unverified' => [fn () => User::factory()->registered()->create()],
    ]);

    it('refuses a guest, a staff session and a deactivated member', function () {
        $this->getJson('/api/v1/me/settings')->assertUnauthorized();
        $this->patchJson('/api/v1/me/settings', ['theme' => 'light'])->assertUnauthorized();

        $this->withCredentials()->withCookie('sc_staff_session', databaseSessionFor(Staff::factory()->create(), 'staff'))
            ->withHeader('Origin', 'http://localhost:8080')
            ->getJson('/api/v1/me/settings')
            ->assertUnauthorized();

        app('auth')->forgetGuards();
        Sanctum::actingAs(User::factory()->deactivated()->create());

        $this->getJson('/api/v1/me/settings')->assertForbidden();
    });
});

it('hashes a password chosen at registration only once', function () {
    $member = User::factory()->create(['password' => 'abc-def-ghi-1']);

    expect(Hash::check('abc-def-ghi-1', $member->password))->toBeTrue();
});
