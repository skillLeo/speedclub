<?php

use App\Enums\NotificationType;
use App\Models\Mention;
use App\Models\Notification;
use App\Models\User;
use App\Services\Social\Mentions;
use Laravel\Sanctum\Sanctum;

require_once __DIR__.'/Social2TestHelpers.php';

/**
 * M4.11 mentions (09 §8.5): parsing, privacy ("Wer darf mich erwähnen"), blocks, samples, spam bound, notifications, suggestions.
 */
beforeEach(function () {
    s2Flags();
    $this->author = User::factory()->create(['username' => 'jann.ptrs']);
    $this->vehicle = publishedVehicle($this->author);
    $this->lukas = User::factory()->create(['username' => 'lukas.sc', 'display_name' => 'Lukas']);
    Sanctum::actingAs($this->author);
});

function s2PostText(string $text): string
{
    return (string) test()->postJson('/api/v1/build-updates', ['vehicle_id' => test()->vehicle->id, 'text' => $text])->assertCreated()->json('data.id');
}

it('parses usernames, ignores e-mail addresses and trailing dots, and caps the count', function () {
    config(['speedclub.social_2.max_mentions' => 2]);

    expect(Mentions::parse('Danke @Lukas.SC. und @mara_gt, mail an info@example.de, @third'))->toBe(['lukas.sc', 'mara_gt']);
});

it('stores and notifies a mention, links it in the update, and never twice on an edit', function () {
    $id = s2PostText('Mit @lukas.sc auf dem Prüfstand.');

    expect(Mention::query()->where('mentioned_user_id', $this->lukas->id)->count())->toBe(1);
    $row = Notification::query()->where('notifiable_id', $this->lukas->id)->where('type', NotificationType::Mention)->sole();
    expect($row->data['update_id'])->toBe($id);
    $this->getJson("/api/v1/build-updates/$id")->assertJsonPath('data.mentions.0.username', 'lukas.sc');

    $this->patchJson("/api/v1/build-updates/$id", ['text' => 'Mit @lukas.sc und Freunden auf dem Prüfstand.'])->assertOk();
    expect(Notification::query()->where('type', NotificationType::Mention)->count())->toBe(1);

    $this->patchJson("/api/v1/build-updates/$id", ['text' => 'Ohne Erwähnung.'])->assertOk();
    expect(Mention::query()->count())->toBe(0);
});

it('respects "Wer darf mich erwähnen", blocks and samples', function (Closure $setup, bool $stored) {
    $setup($this);

    s2PostText('Hallo @lukas.sc');

    expect(Mention::query()->exists())->toBe($stored)
        ->and(Notification::query()->where('type', NotificationType::Mention)->exists())->toBe($stored);
})->with([
    'everyone' => [fn ($t) => null, true],
    'nobody' => [fn ($t) => $t->lukas->forceFill(['mention_privacy' => 'nobody'])->save(), false],
    'followers, author does not follow' => [fn ($t) => $t->lukas->forceFill(['mention_privacy' => 'followers'])->save(), false],
    'followers, author follows' => [function ($t) {
        $t->lukas->forceFill(['mention_privacy' => 'followers'])->save();
        socFollow($t->author, $t->lukas);
    }, true],
    'blocked by the member' => [fn ($t) => socBlock($t->lukas, $t->author), false],
    'sample member while samples are hidden' => [function ($t) {
        $t->lukas->forceFill(['is_sample' => true])->save();
        s2Flags(['editorial_samples' => false]);
    }, false],
    'flag off' => [fn ($t) => s2Flags(['mentions' => false]), false],
]);

it('does not notify a mentioned member who cannot open a followers-only post', function () {
    $this->postJson('/api/v1/build-updates', ['vehicle_id' => $this->vehicle->id, 'text' => '@lukas.sc schau mal', 'audience' => 'followers'])->assertCreated();

    expect(Mention::query()->count())->toBe(1)->and(Notification::query()->where('type', NotificationType::Mention)->count())->toBe(0);
});

describe('GET mentions/suggest', function () {
    it('suggests followed members, followers and earlier mentions that allow it, never across a block', function () {
        $mara = User::factory()->create(['username' => 'mara.gt']);
        $max = User::factory()->create(['username' => 'max.r']);
        $closed = User::factory()->create(['username' => 'mats.e', 'mention_privacy' => 'nobody']);
        $blocked = User::factory()->create(['username' => 'mia.k']);
        User::factory()->create(['username' => 'moritz.fremd']);
        socFollow($this->author, $mara);
        socFollow($max, $this->author);
        socFollow($this->author, $closed);
        socFollow($this->author, $blocked);
        socBlock($blocked, $this->author);

        $this->getJson('/api/v1/mentions/suggest?q=@m')->assertOk()
            ->assertJsonPath('data.*.username', ['mara.gt', 'max.r']);
    });

    it('needs a member and the flag', function () {
        app('auth')->forgetGuards();
        $this->getJson('/api/v1/mentions/suggest?q=a')->assertUnauthorized();
        Sanctum::actingAs($this->author);
        s2Flags(['mentions' => false]);
        $this->getJson('/api/v1/mentions/suggest?q=a')->assertNotFound();
    });
});

it('lets the member choose who may mention them in the settings', function () {
    Sanctum::actingAs($this->lukas);

    $this->patchJson('/api/v1/me/settings', ['mention_privacy' => 'followers'])->assertOk()->assertJsonPath('data.mention_privacy', 'followers');
    $this->patchJson('/api/v1/me/settings', ['mention_privacy' => 'friends'])->assertUnprocessable();
    expect($this->lukas->fresh()->mention_privacy->value)->toBe('followers');
});
