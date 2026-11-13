<?php

use App\Enums\NotificationType;
use App\Models\Notification;
use App\Models\PushToken;
use App\Models\Reaction;
use App\Models\Staff;
use App\Models\User;
use App\Services\Notifications\SendPushNotification;
use Illuminate\Support\Facades\Queue;
use Laravel\Sanctum\Sanctum;

require_once __DIR__.'/Social2TestHelpers.php';

/**
 * M4.11 private reactions (09 §8.5, ADR-413): PUT/DELETE/GET {type}/{id}/reactions. Nobody but the owner ever receives a count.
 */
beforeEach(function () {
    s2Flags();
    $this->owner = User::factory()->create(['username' => 'jann.ptrs']);
    $this->vehicle = publishedVehicle($this->owner);
    $this->update = s2Post($this->vehicle);
    $this->fan = User::factory()->create(['username' => 'lukas.sc']);
});

function s2ReactUrl(string $type, string $id): string
{
    return "/api/v1/$type/$id/reactions";
}

describe('PUT {type}/{id}/reactions', function () {
    it('sets one reaction per member and item, changes it, and answers only my own', function (string $type) {
        $id = $type === 'vehicles' ? $this->vehicle->id : $this->update->id;
        Sanctum::actingAs($this->fan);

        $this->putJson(s2ReactUrl($type, $id), ['reaction' => 'clean'])->assertOk()
            ->assertExactJson(['data' => ['target_type' => $type, 'target_id' => $id, 'my_reaction' => 'clean']]);
        $this->putJson(s2ReactUrl($type, $id), ['reaction' => 'low'])->assertOk()->assertJsonPath('data.my_reaction', 'low');

        expect(Reaction::query()->where('user_id', $this->fan->id)->count())->toBe(1)
            ->and(Reaction::query()->value('type')->value)->toBe('low');
    })->with(['vehicles', 'build-updates']);

    it('validates the reaction', function () {
        Sanctum::actingAs($this->fan);

        $this->putJson(s2ReactUrl('build-updates', $this->update->id), ['reaction' => 'heart'])->assertUnprocessable()->assertJsonValidationErrors('reaction');
    });

    it('applies the authorisation matrix', function (Closure $who, int $status, ?string $code) {
        socActAs($who($this->owner));

        $response = $this->putJson(s2ReactUrl('build-updates', $this->update->id), ['reaction' => 'strong'])->assertStatus($status);

        if ($code !== null) {
            $response->assertJsonPath('code', $code);
        }
    })->with(socMatrix([
        'guest' => [401, 'unauthenticated'],
        'other member' => [200, null],
        'unverified member' => [403, 'email_not_verified'],
        'member restricted from publishing' => [403, 'account_restricted'],
        'member restricted from messaging' => [200, null],
        'suspended member' => [403, 'account_restricted'],
        'deactivated member' => [403, 'forbidden'],
        'member who blocked the other' => [404, 'not_found'],
        'member the other blocked' => [404, 'not_found'],
    ]));

    it('refuses the owner\'s own item, a staff session, a hidden or followers-only update, and the flag off', function () {
        Sanctum::actingAs($this->owner);
        $this->putJson(s2ReactUrl('vehicles', $this->vehicle->id), ['reaction' => 'loud'])->assertForbidden();

        Sanctum::actingAs($this->fan);
        $this->putJson(s2ReactUrl('build-updates', s2Post($this->vehicle, ['hidden' => true])->id), ['reaction' => 'loud'])->assertNotFound();
        $this->putJson(s2ReactUrl('build-updates', s2Post($this->vehicle, ['audience' => 'followers'])->id), ['reaction' => 'loud'])->assertNotFound();
        $this->putJson(s2ReactUrl('build-updates', 'kaputt'), ['reaction' => 'loud'])->assertNotFound();

        s2Flags(['build_reactions' => false]);
        $this->putJson(s2ReactUrl('build-updates', $this->update->id), ['reaction' => 'loud'])->assertNotFound()->assertJsonPath('code', 'feature_disabled');

        app('auth')->forgetGuards();
        $this->actingAs(Staff::factory()->create(), 'staff')->putJson(s2ReactUrl('build-updates', $this->update->id), ['reaction' => 'loud'])->assertUnauthorized();
    });

    it('is rate-limited', function () {
        socLimit('reactions');
        Sanctum::actingAs($this->fan);

        $this->putJson(s2ReactUrl('build-updates', $this->update->id), ['reaction' => 'loud'])->assertOk();
        $this->putJson(s2ReactUrl('build-updates', $this->update->id), ['reaction' => 'low'])->assertStatus(429);
    });

    it('tells the owner once per item and day, never about a change, and pushes at most once an hour', function () {
        config(['speedclub.push.enabled' => true]);
        Queue::fake();
        PushToken::factory()->create(['user_id' => $this->owner->id, 'platform' => 'ios']);
        // The default quiet hours (22:00–07:00 Berlin) hold every push back: without this the count depends on the time of day.
        $this->owner->forceFill(['notification_prefs' => ['quiet_hours' => ['enabled' => false]]])->save();
        $second = User::factory()->create(['username' => 'mara.gt']);

        Sanctum::actingAs($this->fan);
        $this->putJson(s2ReactUrl('build-updates', $this->update->id), ['reaction' => 'clean']);
        $this->putJson(s2ReactUrl('build-updates', $this->update->id), ['reaction' => 'loud']);
        Sanctum::actingAs($second);
        $this->putJson(s2ReactUrl('vehicles', $this->vehicle->id), ['reaction' => 'strong']);

        $rows = Notification::query()->where('notifiable_id', $this->owner->id)->where('type', NotificationType::Reaction)->get();
        expect($rows)->toHaveCount(2);
        Queue::assertPushed(SendPushNotification::class, 1);

        Sanctum::actingAs($this->owner);
        $this->getJson('/api/v1/notifications')->assertOk()
            ->assertJsonPath('data.0.type', 'reaction')
            ->assertJsonPath('data.0.details.target', 'vehicle')
            ->assertJsonPath('data.1.details.update_id', $this->update->id);
    });
});

describe('DELETE {type}/{id}/reactions', function () {
    it('takes my reaction back for any id', function () {
        Reaction::factory()->create(['user_id' => $this->fan->id, 'reactable_id' => $this->update->id]);
        Sanctum::actingAs($this->fan);

        $this->deleteJson(s2ReactUrl('build-updates', $this->update->id))->assertOk()->assertJsonPath('data.my_reaction', null);
        $this->deleteJson(s2ReactUrl('vehicles', '01JAAAAAAAAAAAAAAAAAAAAAAA'))->assertOk();
        expect(Reaction::query()->count())->toBe(0);
    });

    it('needs a member', function () {
        $this->deleteJson(s2ReactUrl('build-updates', $this->update->id))->assertUnauthorized();
        Sanctum::actingAs(User::factory()->deactivated()->create());
        $this->deleteJson(s2ReactUrl('build-updates', $this->update->id))->assertForbidden();
    });
});

describe('GET {type}/{id}/reactions (owner only)', function () {
    it('lists who reacted with the summary, without members the owner may not see', function () {
        foreach (['strong', 'clean', 'clean'] as $type) {
            Reaction::factory()->create(['reactable_id' => $this->update->id, 'type' => $type]);
        }
        $blocked = User::factory()->create();
        Reaction::factory()->create(['user_id' => $blocked->id, 'reactable_id' => $this->update->id, 'type' => 'loud']);
        socBlock($this->owner, $blocked);
        Sanctum::actingAs($this->owner);

        $this->getJson(s2ReactUrl('build-updates', $this->update->id))->assertOk()
            ->assertJsonCount(3, 'data')
            ->assertJsonPath('meta.summary', ['strong' => 1, 'clean' => 2, 'low' => 0, 'loud' => 1, 'total' => 4])
            ->assertJsonStructure(['data' => [['member' => ['username'], 'reaction', 'reacted_at']]]);
    });

    it('refuses everybody but the owner', function () {
        Sanctum::actingAs($this->fan);
        $this->getJson(s2ReactUrl('build-updates', $this->update->id))->assertForbidden();
        app('auth')->forgetGuards();
        $this->getJson(s2ReactUrl('build-updates', $this->update->id))->assertUnauthorized();
    });
});

describe('never a count to anybody but the owner (09 §8.5)', function () {
    it('keeps reaction_summary and followers_count out of every response a non-owner reads', function (?Closure $who) {
        Reaction::factory()->count(3)->create(['reactable_id' => $this->update->id]);
        Reaction::factory()->create(['reactable_type' => 'vehicle', 'reactable_id' => $this->vehicle->id]);
        s2FollowVehicle(User::factory()->create(), $this->vehicle);
        socActAs($who === null ? null : $who($this));

        $bodies = [
            $this->getJson("/api/v1/build-updates/{$this->update->id}")->assertOk()->json(),
            $this->getJson("/api/v1/public/vehicles/{$this->vehicle->slug}")->assertOk()->json(),
            $this->getJson("/api/v1/public/vehicles/{$this->vehicle->slug}/updates")->assertOk()->json(),
        ];

        foreach ($bodies as $body) {
            expect(s2Keys($body))->not->toContain('reaction_summary')->not->toContain('followers_count');
        }
    })->with([
        'guest' => [null],
        'member who reacted' => [function ($test): User {
            Reaction::factory()->create(['user_id' => $test->fan->id, 'reactable_id' => $test->update->id]);

            return $test->fan;
        }],
    ]);

    it('gives the owner the summary on the update and the build', function () {
        Reaction::factory()->count(2)->create(['reactable_id' => $this->update->id, 'type' => 'loud']);
        s2FollowVehicle($this->fan, $this->vehicle);
        Sanctum::actingAs($this->owner);

        $this->getJson("/api/v1/build-updates/{$this->update->id}")->assertJsonPath('data.reaction_summary.loud', 2)->assertJsonPath('data.my_reaction', null);
        $this->getJson("/api/v1/public/vehicles/{$this->vehicle->slug}")->assertJsonPath('data.social.followers_count', 1)->assertJsonPath('data.social.reaction_summary.total', 0);
    });
});
