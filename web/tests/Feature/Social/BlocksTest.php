<?php

use App\Actions\Social\BlockMember;
use App\Http\Middleware\Idempotency;
use App\Models\Block;
use App\Models\BuildUpdate;
use App\Models\Follow;
use App\Models\Media;
use App\Models\Save;
use App\Models\User;
use App\Services\Qr\QrCodes;
use App\Services\Search\VehicleSearchProjector;
use App\Services\Social\MessagingEligibility;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\Route;
use Laravel\Sanctum\Sanctum;

require_once __DIR__.'/SocialTestHelpers.php';

/**
 * M2.1 blocks (contract §3): POST/DELETE users/{username}/block, GET me/blocks, and the audit that a block holds everywhere.
 */
beforeEach(function () {
    $this->viewer = User::factory()->create(['username' => 'ich']);
    $this->member = User::factory()->create(['username' => 'paul.roadster', 'display_name' => 'Paul Roth']);
});

describe('POST users/{username}/block', function () {
    it('blocks, ends follows in both directions, and answers the state', function () {
        socFollow($this->viewer, $this->member);
        socFollow($this->member, $this->viewer);
        $bystander = User::factory()->create();
        socFollow($bystander, $this->member);
        Sanctum::actingAs($this->viewer);

        $this->postJson('/api/v1/users/paul.roadster/block')->assertOk()
            ->assertExactJson(['data' => ['username' => 'paul.roadster', 'is_blocked' => true]]);

        expect(Block::query()->where('blocker_id', $this->viewer->id)->where('blocked_id', $this->member->id)->exists())->toBeTrue()
            ->and(Follow::query()->whereIn('follower_id', [$this->viewer->id, $this->member->id])->whereIn('followee_id', [$this->viewer->id, $this->member->id])->count())->toBe(0)
            ->and(Follow::query()->where('follower_id', $bystander->id)->exists())->toBeTrue();
    });

    it('is idempotent: blocking twice keeps one row and its first date', function () {
        Sanctum::actingAs($this->viewer);
        $this->travelTo('2026-10-01 10:00:00');
        $this->postJson('/api/v1/users/paul.roadster/block')->assertOk();
        $this->travelTo('2026-10-02 10:00:00');
        $this->postJson('/api/v1/users/PAUL.ROADSTER/block')->assertOk()->assertJsonPath('data.username', 'paul.roadster');

        expect(Block::query()->where('blocker_id', $this->viewer->id)->count())->toBe(1)
            ->and(Block::query()->firstOrFail()->getAttribute('created_at')->toDateString())->toBe('2026-10-01');
    });

    it('answers the same whether or not the other member has blocked the viewer', function () {
        $other = User::factory()->create(['username' => 'neutral']);
        socBlock($this->member, $this->viewer);
        Sanctum::actingAs($this->viewer);

        $blockedBack = $this->postJson('/api/v1/users/paul.roadster/block')->assertOk();
        $plain = $this->postJson('/api/v1/users/neutral/block')->assertOk();

        expect(array_keys($blockedBack->json('data')))->toBe(array_keys($plain->json('data')))
            ->and($blockedBack->json('data.is_blocked'))->toBe($plain->json('data.is_blocked'))
            ->and(Block::query()->where('blocker_id', $this->viewer->id)->count())->toBe(2)
            ->and(Block::query()->where('blocker_id', $this->member->id)->count())->toBe(1);
    });

    it('answers with the name as sent, so an old name does not reveal the new one', function () {
        $this->member->forceFill(['username' => 'paul.neu', 'previous_username' => 'paul.roadster', 'username_changed_at' => now()->subDays(2)])->save();
        Sanctum::actingAs($this->viewer);

        $this->postJson('/api/v1/users/paul.roadster/block')->assertOk()->assertJsonPath('data.username', 'paul.roadster');

        expect($this->viewer->hasBlockWith($this->member))->toBeTrue();
    });

    it('blocks any account that exists, also one that is not public', function (Closure $state) {
        $state($this->member);
        Sanctum::actingAs($this->viewer);

        $this->postJson('/api/v1/users/paul.roadster/block')->assertOk()->assertJsonPath('data.is_blocked', true);
    })->with([
        'unverified' => [fn (User $m) => $m->forceFill(['email_verified_at' => null])->save()],
        'suspended' => [fn (User $m) => $m->forceFill(['status' => 'suspended'])->save()],
        'deactivated' => [fn (User $m) => $m->forceFill(['status' => 'deactivated'])->save()],
    ]);

    it('answers 404 member_unavailable only when no account has the name', function () {
        Sanctum::actingAs($this->viewer);

        $this->postJson('/api/v1/users/niemand/block')->assertNotFound()->assertJsonPath('code', 'member_unavailable');

        $this->member->delete();
        $this->postJson('/api/v1/users/paul.roadster/block')->assertNotFound()->assertJsonPath('code', 'member_unavailable');
        expect(Block::query()->count())->toBe(0);
    });

    it('refuses blocking yourself with 422 validation_failed', function () {
        Sanctum::actingAs($this->viewer);

        $this->withHeader('Accept-Language', 'de')->postJson('/api/v1/users/ich/block')->assertUnprocessable()
            ->assertJsonPath('code', 'validation_failed')
            ->assertJsonPath('errors.username.0', 'Du kannst dich nicht selbst blockieren.');

        expect(Block::query()->count())->toBe(0);
    });

    it('stays open as a safety tool, by who asks', function (Closure $viewer, int $status, ?string $code) {
        $actor = $viewer($this->member);
        socActAs($actor);

        $response = $this->postJson('/api/v1/users/paul.roadster/block')->assertStatus($status);

        if ($code !== null) {
            $response->assertJsonPath('code', $code);
        }

        if ($status === 200) {
            expect(Block::query()->where('blocker_id', $actor?->id)->where('blocked_id', $this->member->id)->exists())->toBeTrue();
        }
    })->with(socMatrix([
        'guest' => [401, 'unauthenticated'],
        'other member' => [200, null],
        'unverified member' => [200, null],
        'member restricted from publishing' => [200, null],
        'member restricted from messaging' => [200, null],
        'suspended member' => [200, null],
        'deactivated member' => [403, 'forbidden'],
        'member who blocked the other' => [200, null],
        'member the other blocked' => [200, null],
    ]));

    it('replays an Idempotency-Key', function () {
        Sanctum::actingAs($this->viewer);
        $headers = [Idempotency::HEADER => 'block-1'];

        $this->postJson('/api/v1/users/paul.roadster/block', [], $headers)->assertOk();
        $this->postJson('/api/v1/users/paul.roadster/block', [], $headers)->assertOk()
            ->assertHeader(Idempotency::REPLAYED_HEADER)
            ->assertJsonPath('data.is_blocked', true);
    });

    it('is limited to 100 a day, blocks and unblocks together', function () {
        socLimit('blocks');
        Sanctum::actingAs($this->viewer);

        $this->postJson('/api/v1/users/paul.roadster/block')->assertOk();
        $this->withHeader('Accept-Language', 'de')->deleteJson('/api/v1/users/paul.roadster/block')->assertTooManyRequests()
            ->assertJsonPath('code', 'rate_limited')
            ->assertHeader('Retry-After')
            ->assertJsonPath('message', fn (string $message): bool => str_starts_with($message, 'Du hast heute schon sehr viele Konten blockiert oder freigegeben.'));
    });

    it('carries member, throttle:blocks and idempotent, and not verified-member', function () {
        expect(Route::getRoutes()->getByName('api.v1.blocks.store')?->gatherMiddleware())->toContain('member', 'throttle:blocks', 'idempotent')->not->toContain('verified-member')
            ->and(Route::getRoutes()->getByName('api.v1.blocks.destroy')?->gatherMiddleware())->toContain('member', 'throttle:blocks')->not->toContain('verified-member')
            ->and(config('speedclub.rate_limits.blocks'))->toBe(['max' => 100, 'minutes' => 1440]);
    });
});

describe('DELETE users/{username}/block', function () {
    it('unblocks the own side only and brings no follow back', function () {
        socFollow($this->viewer, $this->member);
        Sanctum::actingAs($this->viewer);
        $this->postJson('/api/v1/users/paul.roadster/block')->assertOk();
        socBlock($this->member, $this->viewer);

        $this->deleteJson('/api/v1/users/paul.roadster/block')->assertOk()
            ->assertExactJson(['data' => ['username' => 'paul.roadster', 'is_blocked' => false]]);

        expect(Block::query()->where('blocker_id', $this->viewer->id)->exists())->toBeFalse()
            ->and(Block::query()->where('blocker_id', $this->member->id)->exists())->toBeTrue()
            ->and(Follow::query()->count())->toBe(0);
    });

    it('answers 200 for any name', function (string $name) {
        Sanctum::actingAs($this->viewer);

        $this->deleteJson("/api/v1/users/$name/block")->assertOk()->assertExactJson(['data' => ['username' => $name, 'is_blocked' => false]]);
    })->with(['niemand', 'paul.roadster', 'ich']);

    it('makes the profile visible again', function () {
        Sanctum::actingAs($this->viewer);
        $this->postJson('/api/v1/users/paul.roadster/block')->assertOk();
        $this->getJson('/api/v1/public/users/paul.roadster')->assertNotFound();

        $this->deleteJson('/api/v1/users/paul.roadster/block')->assertOk();
        $this->getJson('/api/v1/public/users/paul.roadster')->assertOk();
    });

    it('is open by who asks', function (Closure $viewer, int $status, ?string $code) {
        $actor = $viewer($this->member);
        socActAs($actor);

        $response = $this->deleteJson('/api/v1/users/paul.roadster/block')->assertStatus($status);

        if ($code !== null) {
            $response->assertJsonPath('code', $code);
        }
    })->with(socMatrix([
        'guest' => [401, 'unauthenticated'],
        'other member' => [200, null],
        'unverified member' => [200, null],
        'member restricted from publishing' => [200, null],
        'member restricted from messaging' => [200, null],
        'suspended member' => [200, null],
        'deactivated member' => [403, 'forbidden'],
        'member who blocked the other' => [200, null],
        'member the other blocked' => [200, null],
    ]));
});

describe('GET me/blocks', function () {
    it('lists whom the member blocked, newest first, with the date', function () {
        $older = User::factory()->create(['username' => 'aelter', 'display_name' => 'Älter']);
        Block::factory()->create(['blocker_id' => $this->viewer->id, 'blocked_id' => $older->id, 'created_at' => '2026-09-01 10:00:00']);
        Block::factory()->create(['blocker_id' => $this->viewer->id, 'blocked_id' => $this->member->id, 'created_at' => '2026-10-01 10:00:00']);
        // Blocks against the viewer are not the viewer's list.
        socBlock(User::factory()->create(['username' => 'gegen.mich']), $this->viewer);
        Sanctum::actingAs($this->viewer);

        $response = $this->getJson('/api/v1/me/blocks')->assertOk();

        // M2.1 review #1: the name as sent and the date, nothing live of the blocked member.
        expect($response->json('data'))->toBe([
            ['username' => 'paul.roadster', 'blocked_at' => '2026-10-01T10:00:00+00:00'],
            ['username' => 'aelter', 'blocked_at' => '2026-09-01T10:00:00+00:00'],
        ]);
    });

    it('shows no live data of a member who blocked the viewer back and then changed the profile', function () {
        Sanctum::actingAs($this->member);
        $this->postJson('/api/v1/users/ich/block')->assertOk();
        Sanctum::actingAs($this->viewer);
        $this->postJson('/api/v1/users/paul.roadster/block')->assertOk();
        $this->member->forceFill(['username' => 'paul.neu', 'previous_username' => 'paul.roadster', 'username_changed_at' => now(), 'display_name' => 'Neuer Name'])->save();
        $this->member->forceFill(['avatar_media_id' => Media::factory()->create(['owner_id' => $this->member->id])->id])->save();

        $body = $this->getJson('/api/v1/me/blocks')->assertOk()->json('data');

        expect($body)->toHaveCount(1)
            ->and(array_keys($body[0]))->toBe(['username', 'blocked_at'])
            ->and($body[0]['username'])->toBe('paul.roadster')
            ->and(json_encode($body))->not->toContain('paul.neu')->not->toContain('Neuer Name');
    });

    it('shows a block by an old name with the name as sent, never the new one, and unblocks by it', function () {
        $this->member->forceFill(['username' => 'paul.neu', 'previous_username' => 'paul.roadster', 'username_changed_at' => now()->subDays(2)])->save();
        Sanctum::actingAs($this->viewer);

        $this->postJson('/api/v1/users/Paul.Roadster/block')->assertOk()->assertJsonPath('data.username', 'paul.roadster');

        expect($this->getJson('/api/v1/me/blocks')->json('data.*.username'))->toBe(['paul.roadster']);

        // After the 14 days the old name no longer resolves; the row still unblocks by the name it shows.
        $this->member->forceFill(['username_changed_at' => now()->subDays(30)])->save();
        $this->deleteJson('/api/v1/users/paul.roadster/block')->assertOk()->assertJsonPath('data.is_blocked', false);

        expect(Block::query()->count())->toBe(0);
    });

    it('keeps the first name when a member is blocked twice', function () {
        Sanctum::actingAs($this->viewer);
        $this->postJson('/api/v1/users/paul.roadster/block')->assertOk();
        $this->member->forceFill(['username' => 'paul.neu', 'previous_username' => 'paul.roadster', 'username_changed_at' => now()])->save();
        $this->postJson('/api/v1/users/paul.neu/block')->assertOk();

        expect(Block::query()->pluck('blocked_username')->all())->toBe(['paul.roadster']);
    });

    it('shows only the name for a blocked member who is suspended or unverified', function (Closure $state) {
        $other = User::factory()->create(['username' => 'gesperrt', 'display_name' => 'Geheim']);
        socBlock($this->viewer, $other);
        $state($other);
        Sanctum::actingAs($this->viewer);

        expect($this->getJson('/api/v1/me/blocks')->json('data'))->toBe([['username' => 'gesperrt', 'blocked_at' => Block::query()->first()?->created_at?->toIso8601String()]]);
    })->with([
        'suspended' => [fn (User $member) => $member->forceFill(['status' => 'suspended'])->save()],
        'unverified' => [fn (User $member) => $member->forceFill(['email_verified_at' => null])->save()],
    ]);

    it('fails loudly instead of swallowing a block of a member who does not exist', function () {
        expect(fn () => app(BlockMember::class)->handle($this->viewer, User::factory()->make(['id' => '01jaaaaaaaaaaaaaaaaaaaaaaa'])))
            ->toThrow(QueryException::class);
    });

    it('leaves out a member who has deleted the account', function () {
        socBlock($this->viewer, $this->member);
        $gone = User::factory()->create();
        socBlock($this->viewer, $gone);
        $gone->delete();
        socBlock($this->viewer, User::factory()->deactivated()->create());
        socBlock($this->viewer, User::factory()->suspended()->create(['username' => 'gesperrt']));
        Sanctum::actingAs($this->viewer);

        expect(array_column($this->getJson('/api/v1/me/blocks')->json('data'), 'username'))->toEqualCanonicalizing(['paul.roadster', 'gesperrt']);
    });

    it('pages with a cursor', function () {
        foreach (range(1, 3) as $i) {
            Block::factory()->create(['blocker_id' => $this->viewer->id, 'blocked_id' => User::factory()->create(['username' => "b.$i"])->id, 'created_at' => "2026-10-0{$i} 10:00:00"]);
        }

        Sanctum::actingAs($this->viewer);

        $first = $this->getJson('/api/v1/me/blocks?per_page=2')->assertOk();
        $second = $this->getJson('/api/v1/me/blocks?per_page=2&cursor='.$first->json('meta.next_cursor'))->assertOk();

        expect([...array_column($first->json('data'), 'username'), ...array_column($second->json('data'), 'username')])->toBe(['b.3', 'b.2', 'b.1'])
            ->and($second->json('meta.next_cursor'))->toBeNull();
    });

    it('refuses a bad page size or cursor', function (string $query, string $field) {
        Sanctum::actingAs($this->viewer);

        $this->getJson('/api/v1/me/blocks?'.$query)->assertUnprocessable()->assertJsonValidationErrorFor($field);
    })->with([
        'per_page 51' => ['per_page=51', 'per_page'],
        'cursor of another list' => ['cursor='.rtrim(strtr(base64_encode((string) json_encode(['saves.created_at' => '2026-01-01', 'saves.id' => 1, '_pointsToNextItems' => true])), '+/', '-_'), '='), 'cursor'],
    ]);

    it('is open by who asks', function (Closure $viewer, int $status, ?string $code) {
        socActAs($viewer($this->member));

        $response = $this->getJson('/api/v1/me/blocks')->assertStatus($status);

        if ($code !== null) {
            $response->assertJsonPath('code', $code);
        }
    })->with(socMatrix([
        'guest' => [401, 'unauthenticated'],
        'other member' => [200, null],
        'unverified member' => [200, null],
        'member restricted from publishing' => [200, null],
        'member restricted from messaging' => [200, null],
        'suspended member' => [200, null],
        'deactivated member' => [403, 'forbidden'],
        'member who blocked the other' => [200, null],
        'member the other blocked' => [200, null],
    ]));
});

/**
 * The block audit of contract §3: every read and write that exists, in both directions.
 */
describe('a block holds everywhere, in both directions', function () {
    beforeEach(function () {
        seedModSchema();
        $this->vehicle = publishedVehicle($this->member);
        $this->unlisted = publishedVehicle($this->member, ['visibility' => 'unlisted']);
        $this->mod = modIn($this->vehicle, 'exhaust');
        $this->update = BuildUpdate::factory()->create(['vehicle_id' => $this->vehicle->id]);
        $this->qr = app(QrCodes::class)->ensureActive($this->vehicle);
        app(VehicleSearchProjector::class)->rebuild($this->vehicle->id);
        // A third member whose lists include the blocked one.
        $this->third = User::factory()->create(['username' => 'dritter']);
        socFollow($this->member, $this->third);
        socFollow($this->third, $this->member);
    });

    dataset('directions', [
        'the viewer blocked the member' => [fn (User $viewer, User $member) => socBlock($viewer, $member)],
        'the member blocked the viewer' => [fn (User $viewer, User $member) => socBlock($member, $viewer)],
    ]);

    it('hides the member on every API read', function (Closure $block) {
        $block($this->viewer, $this->member);
        Sanctum::actingAs($this->viewer);
        $slug = $this->vehicle->canonicalSlug();

        foreach (['', '/vehicles', '/followers', '/following'] as $suffix) {
            $this->getJson('/api/v1/public/users/paul.roadster'.$suffix)->assertNotFound()->assertJsonPath('code', 'member_unavailable');
        }

        foreach (["/$slug", '/'.$this->unlisted->canonicalSlug(), "/$slug/mods/{$this->mod->id}", "/$slug/updates", "/$slug/updates/{$this->update->id}"] as $path) {
            $this->getJson('/api/v1/public/vehicles'.$path)->assertNotFound()->assertJsonPath('code', 'vehicle_unavailable');
        }

        expect(array_column($this->getJson('/api/v1/public/users/dritter/followers')->assertOk()->json('data'), 'username'))->not->toContain('paul.roadster')
            ->and(array_column($this->getJson('/api/v1/public/users/dritter/following')->assertOk()->json('data'), 'username'))->not->toContain('paul.roadster')
            ->and($this->getJson('/api/v1/search/users?q=paul')->assertOk()->json('data'))->toBe([])
            ->and(array_column($this->getJson('/api/v1/search/vehicles?q='.urlencode((string) $this->vehicle->make?->name))->assertOk()->json('data'), 'id'))->not->toContain($this->vehicle->id)
            ->and(array_column($this->getJson('/api/v1/home/new-builds')->assertOk()->json('data'), 'id'))->not->toContain($this->vehicle->id)
            ->and(array_column($this->getJson('/api/v1/home/featured')->assertOk()->json('data'), 'id'))->not->toContain($this->vehicle->id)
            ->and(json_encode($this->getJson('/api/v1/discover')->assertOk()->json()))->not->toContain('paul.roadster');

        $this->getJson('/api/v1/qr/'.$this->qr->code)->assertOk()->assertJsonPath('data.state', 'private')->assertJsonPath('data.slug', null);
    })->with('directions');

    it('refuses every write toward the member', function (Closure $block) {
        socSavesOn();
        $block($this->viewer, $this->member);
        Sanctum::actingAs($this->viewer);

        $this->postJson('/api/v1/users/paul.roadster/follow')->assertNotFound()->assertJsonPath('code', 'member_unavailable');
        $this->postJson("/api/v1/vehicles/{$this->vehicle->id}/save")->assertNotFound()->assertJsonPath('code', 'vehicle_unavailable');
        $this->postJson("/api/v1/vehicles/{$this->unlisted->id}/save")->assertNotFound()->assertJsonPath('code', 'vehicle_unavailable');

        expect(Follow::query()->where('follower_id', $this->viewer->id)->exists())->toBeFalse()
            ->and(Save::query()->where('user_id', $this->viewer->id)->exists())->toBeFalse()
            ->and(app(MessagingEligibility::class)->canMessage($this->viewer, $this->member))->toBeFalse()
            ->and(app(MessagingEligibility::class)->canMessage($this->member, $this->viewer))->toBeFalse();
    })->with('directions');

    it('drops the member\'s builds from the saved list while it lasts, and keeps the save', function (Closure $block) {
        socSavesOn();
        Save::factory()->create(['user_id' => $this->viewer->id, 'vehicle_id' => $this->vehicle->id]);
        $block($this->viewer, $this->member);
        Sanctum::actingAs($this->viewer);

        $this->getJson('/api/v1/me/saved')->assertOk()->assertJsonCount(0, 'data');
        expect(Save::query()->where('user_id', $this->viewer->id)->count())->toBe(1);

        Block::query()->delete();
        $this->getJson('/api/v1/me/saved')->assertOk()->assertJsonPath('data.0.id', $this->vehicle->id);
    })->with('directions');

    it('gives a signed-in browser the 404 page on /u and /v, with ?view=public and with the redirect off', function (Closure $block, bool $redirect, string $query) {
        config(['speedclub.public_pages.redirect_members_to_app' => $redirect]);
        $block($this->viewer, $this->member);
        app('session')->forgetDrivers();
        $cookie = databaseSessionFor($this->viewer, 'web');

        $this->withCookie(config()->string('session.cookie'), $cookie)->get('/u/paul.roadster'.$query)->assertNotFound()->assertSee('data-state="member_unavailable"', false);
        $this->withCookie(config()->string('session.cookie'), $cookie)->get('/v/'.$this->vehicle->canonicalSlug().$query)->assertNotFound()->assertSee('data-state="vehicle_unavailable"', false);
        $this->withCookie(config()->string('session.cookie'), $cookie)->get('/c/'.$this->qr->code)->assertNotFound()->assertSee('data-state="private"', false);
    })->with('directions')->with([
        'redirect on, ?view=public' => [true, '?view=public'],
        'redirect off' => [false, ''],
    ]);

    it('leaves the pages to anybody else and to guests', function (Closure $block) {
        config(['speedclub.public_pages.redirect_members_to_app' => false]);
        $block($this->viewer, $this->member);
        app('session')->forgetDrivers();
        $cookie = databaseSessionFor($this->third, 'web');

        $this->withCookie(config()->string('session.cookie'), $cookie)->get('/u/paul.roadster')->assertOk();
        $this->withCookie(config()->string('session.cookie'), $cookie)->get('/v/'.$this->vehicle->canonicalSlug())->assertOk();
        $this->get('/u/paul.roadster')->assertOk();
        $this->getJson('/api/v1/public/users/paul.roadster')->assertOk();
    })->with('directions');

    it('ends at unblock: the member is visible again on every read', function () {
        Sanctum::actingAs($this->viewer);
        $this->postJson('/api/v1/users/paul.roadster/block')->assertOk();
        $this->deleteJson('/api/v1/users/paul.roadster/block')->assertOk();

        $this->getJson('/api/v1/public/users/paul.roadster')->assertOk();
        $this->getJson('/api/v1/public/vehicles/'.$this->vehicle->canonicalSlug())->assertOk();
        $this->getJson('/api/v1/qr/'.$this->qr->code)->assertJsonPath('data.state', 'active');
        expect(array_column($this->getJson('/api/v1/home/new-builds')->json('data'), 'id'))->toContain($this->vehicle->id);
    });
});
