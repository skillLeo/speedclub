<?php

use App\Enums\RestrictionType;
use App\Enums\WhoCanMessage;
use App\Models\Block;
use App\Models\User;
use App\Services\Social\MessagingEligibility;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;

require_once __DIR__.'/SocialTestHelpers.php';

/**
 * M2.1 PROF-02 (contract §1): follows_you and can_message on GET public/users/{username}, and the one rule behind can_message that
 * M2.4 enforces on POST conversations.
 */
beforeEach(function () {
    $this->member = User::factory()->create(['username' => 'kenji.r34', 'who_can_message' => WhoCanMessage::Everyone]);
});

function socProfile(): mixed
{
    return test()->getJson('/api/v1/public/users/kenji.r34')->assertOk();
}

describe('follows_you', function () {
    it('is true when the member follows the viewer, and false the other way round', function () {
        $viewer = User::factory()->create();
        socFollow($this->member, $viewer);
        Sanctum::actingAs($viewer);

        socProfile()->assertJsonPath('data.follows_you', true)->assertJsonPath('data.is_following', false);
    });

    it('is false for guests and on the own profile', function () {
        socProfile()->assertJsonPath('data.follows_you', false)->assertJsonPath('data.can_message', false);

        Sanctum::actingAs($this->member);
        socProfile()->assertJsonPath('data.is_self', true)->assertJsonPath('data.follows_you', false)->assertJsonPath('data.can_message', false);
    });

    it('rides along on the owner of a vehicle page', function () {
        $viewer = User::factory()->create();
        socFollow($this->member, $viewer);
        Sanctum::actingAs($viewer);

        $this->getJson('/api/v1/public/vehicles/'.publishedVehicle($this->member)->canonicalSlug())->assertOk()
            ->assertJsonPath('data.owner.follows_you', true)
            ->assertJsonPath('data.owner.can_message', true);
    });
});

describe('can_message', function () {
    it('follows who asks and the member\'s setting', function (Closure $setup, bool $expected) {
        $viewer = $setup($this->member);
        socActAs($viewer);

        socProfile()->assertJsonPath('data.can_message', $expected);
        expect(app(MessagingEligibility::class)->canMessage($viewer, $this->member->refresh()))->toBe($expected);
    })->with([
        'guest' => [fn () => null, false],
        'verified member, everyone' => [fn () => User::factory()->create(), true],
        'unverified member' => [fn () => User::factory()->unverified()->create(), false],
        'restricted from messaging' => [fn () => User::factory()->restrictedFrom(RestrictionType::Messaging)->create(), false],
        'restricted from messaging until yesterday' => [fn () => User::factory()->restrictedFrom(RestrictionType::Messaging, now()->subDay())->create(), true],
        'restricted from publishing only' => [fn () => User::factory()->restrictedFrom(RestrictionType::Publishing)->create(), true],
        'suspended viewer' => [fn () => User::factory()->suspended()->create(), false],
        'member set to nobody' => [function (User $m) {
            $m->forceFill(['who_can_message' => WhoCanMessage::Nobody])->save();

            return User::factory()->create();
        }, false],
        'member set to following, and follows the viewer' => [function (User $m) {
            $m->forceFill(['who_can_message' => WhoCanMessage::Following])->save();
            $viewer = User::factory()->create();
            socFollow($m, $viewer);

            return $viewer;
        }, true],
        'member set to following, viewer follows the member only' => [function (User $m) {
            $m->forceFill(['who_can_message' => WhoCanMessage::Following])->save();
            $viewer = User::factory()->create();
            socFollow($viewer, $m);

            return $viewer;
        }, false],
    ]);

    it('is false across a block and for a member who is not public, in the rule itself', function () {
        $viewer = User::factory()->create();
        $eligibility = app(MessagingEligibility::class);

        socBlock($this->member, $viewer);
        expect($eligibility->canMessage($viewer, $this->member))->toBeFalse();

        Block::query()->delete();
        $this->member->forceFill(['status' => 'suspended'])->save();
        expect($eligibility->canMessage($viewer, $this->member))->toBeFalse()
            ->and($eligibility->canMessage($viewer, $viewer))->toBeFalse();
    });
});

describe('stats', function () {
    it('count the followers PROF-04 can list: active and verified', function () {
        socFollow(User::factory()->create(), $this->member);
        socFollow(User::factory()->unverified()->create(), $this->member);
        socFollow(User::factory()->suspended()->create(), $this->member);
        socFollow($this->member, User::factory()->unverified()->create());
        socFollow($this->member, User::factory()->create());

        socProfile()->assertJsonPath('data.stats.followers', 1)->assertJsonPath('data.stats.following', 1);
        expect(count($this->getJson('/api/v1/public/users/kenji.r34/followers')->json('data')))->toBe(1);
    });

    it('are the number of the follow button too', function () {
        socFollow(User::factory()->unverified()->create(), $this->member);
        Sanctum::actingAs(User::factory()->create());

        $this->postJson('/api/v1/users/kenji.r34/follow')->assertOk()->assertJsonPath('data.followers', 1);
    });
});

it('reads both follow directions in one query and asks nothing twice (M2.1 review #10)', function () {
    $viewer = User::factory()->create();
    $member = User::factory()->create(['username' => 'zwei.wege', 'who_can_message' => 'following']);
    socFollow($viewer, $member);
    socFollow($member, $viewer);
    Sanctum::actingAs($viewer);

    DB::flushQueryLog();
    DB::enableQueryLog();
    $this->getJson('/api/v1/public/users/zwei.wege')->assertOk()
        ->assertJsonPath('data.is_following', true)
        ->assertJsonPath('data.follows_you', true)
        ->assertJsonPath('data.can_message', true);
    $follows = array_filter(DB::getQueryLog(), fn (array $query): bool => str_contains($query['query'], 'from `follows`') && ! str_contains($query['query'], 'count('));

    expect($follows)->toHaveCount(1);
});
