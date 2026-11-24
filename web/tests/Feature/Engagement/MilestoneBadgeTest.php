<?php

use App\Enums\BadgeMetric;
use App\Enums\ForumPostStatus;
use App\Enums\NotificationType;
use App\Models\Badge;
use App\Models\Notification;
use App\Models\User;
use App\Models\UserBadge;
use App\Models\ViewDay;
use App\Services\Badges\BadgeAwarder;
use App\Services\Badges\BadgeMetrics;
use Database\Seeders\BadgeSeeder;
use Illuminate\Support\Facades\DB;

require_once __DIR__.'/EngagementTestHelpers.php';
require_once __DIR__.'/../Forum/ForumTestHelpers.php';

/**
 * M5.7 milestones (10 §6.4, m5.7-contract §5): the quiet badges are M5.9d badges. New: "100 Aufrufe" (views received, a threshold) and
 * "Hilfreich" (forum "Hilfreich" votes received, inactive like the other forum badges). Awarded by the nightly run without a push; never
 * to samples.
 */
beforeEach(function () {
    $this->seed(BadgeSeeder::class);
});

it('seeds the two milestones once, the forum one inactive', function () {
    $this->seed(BadgeSeeder::class);

    expect(Badge::query()->whereKey('100-aufrufe')->sole()->only(['active', 'rule_json']))
        ->toEqual(['active' => true, 'rule_json' => ['metric' => 'views_received', 'gte' => 100]])
        ->and(Badge::query()->whereKey('hilfreich-10')->sole()->only(['active', 'rule_json']))
        ->toEqual(['active' => false, 'rule_json' => ['metric' => 'helpful_received', 'gte' => 10]])
        ->and(Badge::query()->count())->toBe(33);
});

it('reads the views of the profile and every car, all time', function () {
    $member = User::factory()->create();
    $car = publishedVehicle($member);
    ViewDay::factory()->forProfile($member)->create(['views' => 40, 'day' => '2026-01-01']);
    ViewDay::factory()->forVehicle($car)->create(['views' => 60]);
    ViewDay::factory()->forProfile(User::factory()->create())->create(['views' => 500]);

    expect(app(BadgeMetrics::class)->values(BadgeMetric::ViewsReceived, null, [$member->id]))->toBe([$member->id => 100]);
});

it('reads "Hilfreich" votes on published posts only, never the author\'s own', function () {
    $author = forumMember();
    $thread = forumThread();
    $post = forumReply($thread, $author);
    $hidden = forumReply($thread, $author, ['status' => ForumPostStatus::Pending]);

    foreach (User::factory()->count(3)->create() as $voter) {
        DB::table('forum_votes')->insert(['post_id' => $post->id, 'user_id' => $voter->id, 'created_at' => now()]);
        DB::table('forum_votes')->insert(['post_id' => $hidden->id, 'user_id' => $voter->id, 'created_at' => now()]);
    }

    DB::table('forum_votes')->insert(['post_id' => $post->id, 'user_id' => $author->id, 'created_at' => now()]);

    expect(app(BadgeMetrics::class)->values(BadgeMetric::HelpfulReceived, null, [$author->id]))->toBe([$author->id => 3]);
});

it('awards "100 Aufrufe" quietly in the nightly run, with the toast row and no push', function () {
    $member = User::factory()->create();
    ViewDay::factory()->forProfile($member)->create(['views' => 100]);

    app(BadgeAwarder::class)->evaluate($member, 'nightly', push: false);

    expect(UserBadge::query()->where('user_id', $member->id)->pluck('badge_key')->all())->toContain('100-aufrufe')
        ->and(Notification::query()->where('notifiable_id', $member->id)->where('type', NotificationType::BadgeUnlocked)->whereNotNull('pushed_at')->exists())->toBeFalse();

    $this->actingAs($member, 'sanctum')->getJson('/api/v1/me/badges?unseen=1')->assertOk()
        ->assertJsonFragment(['key' => '100-aufrufe']);
});

it('never awards it below the threshold or to a sample member', function () {
    $few = User::factory()->create();
    ViewDay::factory()->forProfile($few)->create(['views' => 99]);
    $sample = User::factory()->create(['is_sample' => true]);
    ViewDay::factory()->forProfile($sample)->create(['views' => 1000]);

    app(BadgeAwarder::class)->evaluate($few, 'nightly', push: false);
    app(BadgeAwarder::class)->evaluate($sample, 'nightly', push: false);

    expect(UserBadge::query()->where('badge_key', '100-aufrufe')->count())->toBe(0);
});
