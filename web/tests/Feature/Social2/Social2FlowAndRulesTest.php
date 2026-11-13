<?php

use App\Enums\NotificationType;
use App\Models\Comment;
use App\Models\FeatureFlag;
use App\Models\Notification;
use App\Models\Reaction;
use App\Models\User;
use App\Services\Notifications\NotificationFeed;
use App\Services\Notifications\NotificationTexts;
use App\Services\Notifications\Notifier;
use Database\Seeders\FeatureFlagSeeder;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;

require_once __DIR__.'/Social2TestHelpers.php';

/**
 * M4.11: the F11 flow at API level (09 §14.5), push texts, the sample rule (09 §8.19) and the flags (09 §8.18).
 */
beforeEach(function () {
    s2Flags();
    socSavesOn();
    $this->a = User::factory()->create(['username' => 'jann.ptrs', 'locale' => 'de']);
    $this->b = User::factory()->create(['username' => 'lukas.sc', 'locale' => 'de']);
    $this->vehicle = publishedVehicle($this->a);
});

it('F11: A posts with @B, B is told, reacts "Sauber", saves the build into a new collection and follows it; A sees the private list, B never a count', function () {
    Sanctum::actingAs($this->a);
    $update = $this->postJson('/api/v1/build-updates', ['vehicle_id' => $this->vehicle->id, 'text' => 'Neue Felgen, danke @lukas.sc fürs Helfen!'])->assertCreated()->json('data.id');

    Sanctum::actingAs($this->b);
    $this->getJson('/api/v1/notifications')->assertOk()->assertJsonPath('data.0.type', 'mention')->assertJsonPath('data.0.details.update_id', $update);
    $this->putJson("/api/v1/build-updates/$update/reactions", ['reaction' => 'clean'])->assertOk();
    $collection = $this->postJson('/api/v1/me/collections', ['name' => 'Felgen-Ideen'])->assertCreated()->json('data.id');
    $this->postJson("/api/v1/me/collections/$collection/items", ['type' => 'vehicle', 'id' => $this->vehicle->id])->assertCreated();
    $this->putJson("/api/v1/vehicles/{$this->vehicle->id}/follow")->assertOk();

    $bodies = [
        $this->getJson("/api/v1/build-updates/$update")->assertJsonPath('data.my_reaction', 'clean')->json(),
        $this->getJson("/api/v1/public/vehicles/{$this->vehicle->slug}")->assertJsonPath('data.social.is_following', true)->json(),
    ];
    $this->getJson("/api/v1/build-updates/$update/reactions")->assertForbidden();

    foreach ($bodies as $body) {
        expect(s2Keys($body))->not->toContain('reaction_summary')->not->toContain('followers_count');
    }

    Sanctum::actingAs($this->a);
    $this->getJson("/api/v1/build-updates/$update/reactions")->assertOk()
        ->assertJsonPath('data.0.member.username', 'lukas.sc')->assertJsonPath('data.0.reaction', 'clean')->assertJsonPath('meta.summary.clean', 1);
    $this->getJson('/api/v1/notifications')->assertJsonPath('data.0.type', 'vehicle_follower');
});

it('writes push texts in the recipient\'s language naming who and which build, never a text or a foreign count', function () {
    $update = s2Post($this->vehicle);
    $notifier = app(Notifier::class);
    $notifier->reaction($this->a, $this->b, $this->vehicle, $update);
    $notifier->mention($this->b, $this->a, $this->vehicle, $update);
    $notifier->vehicleFollower($this->a, $this->b, $this->vehicle);
    $notifier->comment($this->a, $this->b, $this->vehicle, $update, Comment::factory()->create(['build_update_id' => $update->id, 'user_id' => $this->b->id]), reply: false);

    $texts = [];

    foreach (Notification::query()->get() as $row) {
        $recipient = User::query()->findOrFail($row->notifiable_id);
        $shown = app(NotificationFeed::class)->find($recipient, $row->id);
        $texts[$row->type->value] = app(NotificationTexts::class)->push($shown, $recipient)['body'] ?? null;
        expect(app(NotificationTexts::class)->path($shown))->toStartWith('/v/');
    }

    expect($texts[NotificationType::Reaction->value])->toStartWith('@lukas.sc hat auf dein Update')
        ->and($texts[NotificationType::Mention->value])->toStartWith('@jann.ptrs hat dich in einem Update')
        ->and($texts[NotificationType::VehicleFollower->value])->toStartWith('@lukas.sc folgt jetzt deinem Build')
        ->and($texts[NotificationType::Comment->value])->not->toContain('Sauber gemacht');
});

it('drops a blocked member\'s reaction, mention and follow rows from the list', function () {
    $update = s2Post($this->vehicle);
    app(Notifier::class)->reaction($this->a, $this->b, $this->vehicle, $update);
    socBlock($this->a, $this->b);
    Sanctum::actingAs($this->a);

    $this->getJson('/api/v1/notifications')->assertJsonCount(0, 'data');
});

describe('sample content (09 §8.19)', function () {
    it('hides sample members\' reactions, comments and sample builds in collections while editorial_samples is off', function () {
        s2Flags(['build_comments' => true, 'editorial_samples' => false]);
        $sample = User::factory()->create(['is_sample' => true]);
        $update = s2Post($this->vehicle);
        Reaction::factory()->create(['user_id' => $sample->id, 'reactable_id' => $update->id]);
        Comment::factory()->create(['build_update_id' => $update->id, 'user_id' => $sample->id]);

        Sanctum::actingAs($this->a);
        $this->getJson("/api/v1/build-updates/{$update->id}/reactions")->assertJsonCount(0, 'data');
        $this->getJson("/api/v1/build-updates/{$update->id}/comments")->assertJsonCount(0, 'data');

        $sampleBuild = publishedVehicle(User::factory()->create(['is_sample' => true]));
        Sanctum::actingAs($this->b);
        $collection = $this->postJson('/api/v1/me/collections', ['name' => 'Beispiele'])->json('data.id');
        $this->postJson("/api/v1/me/collections/$collection/items", ['type' => 'vehicle', 'id' => $sampleBuild->id])->assertNotFound();
        s2Flags(['editorial_samples' => true]);
        $this->postJson("/api/v1/me/collections/$collection/items", ['type' => 'vehicle', 'id' => $sampleBuild->id])->assertCreated();
        s2Flags(['editorial_samples' => false]);
        $this->getJson("/api/v1/me/collections/$collection/items")->assertJsonCount(0, 'data');
    });
});

describe('flags (09 §8.18)', function () {
    it('seeds build_reactions, mentions, collections and vehicle_follow on and build_comments off, in every environment', function () {
        FeatureFlag::query()->delete();
        $this->app['env'] = 'production';
        app(FeatureFlagSeeder::class)->setContainer(app())->__invoke();
        $this->app['env'] = 'testing';

        expect(FeatureFlag::query()->whereIn('key', ['build_reactions', 'mentions', 'collections', 'vehicle_follow', 'build_comments'])->pluck('enabled', 'key')->all())
            ->toBe(['build_comments' => false, 'build_reactions' => true, 'collections' => true, 'mentions' => true, 'vehicle_follow' => true]);
    });

    it('reaches a seeded host by the data migration without touching an admin\'s choice, and leaves an empty table alone', function () {
        $migration = require database_path('migrations/2026_11_30_100100_add_social_2_0_flags.php');
        FeatureFlag::query()->delete();

        $migration->up();
        expect(FeatureFlag::query()->count())->toBe(0);

        FeatureFlag::query()->create(['key' => 'editorial_samples', 'enabled' => true]);
        FeatureFlag::query()->create(['key' => 'mentions', 'enabled' => false]);
        $migration->up();

        expect(DB::table('feature_flags')->pluck('enabled', 'key')->map(fn ($v) => (bool) $v)->all())
            ->toMatchArray(['mentions' => false, 'build_reactions' => true, 'collections' => true, 'vehicle_follow' => true, 'build_comments' => false]);
    });
});
