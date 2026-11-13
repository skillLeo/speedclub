<?php

use App\Enums\PowerSource;
use App\Enums\PowerUnit;
use App\Models\Message;
use App\Models\User;
use App\Models\VehicleSearch;
use App\Models\VehicleSpec;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

require_once __DIR__.'/MessagingTestHelpers.php';
require_once __DIR__.'/../Home/HomeTestHelpers.php';

/**
 * Phase 4 lane B (ADR-445, DQ-1086, DQ-1096): replies with reply_to, the four car reactions, and the partner's main build on a
 * conversation.
 */
beforeEach(function () {
    msgFlags();
    Storage::fake('public');
    Storage::fake('local');
    $this->lukas = ntfMember('lukas.sc');
    $this->jann = ntfMember('jann.ptrs');
    $this->first = msgStart($this->jann, $this->lukas, 'Moin Lukas, wie läuft der R34?');
    $this->id = $this->first->conversation_id;
});

function rplSend(string $conversation, array $body): mixed
{
    return test()->postJson("/api/v1/conversations/$conversation/messages", ['type' => 'text', 'body' => 'Läuft super!', 'client_id' => (string) Str::uuid(), ...$body]);
}

describe('replies (SM11)', function () {
    it('stores reply_to_id and quotes the message for both sides', function () {
        msgActAs($this->lukas);

        $reply = rplSend($this->id, ['reply_to_id' => strtoupper($this->first->id)])->assertCreated()
            ->assertJsonPath('data.reply_to', ['id' => $this->first->id, 'type' => 'text', 'body' => 'Moin Lukas, wie läuft der R34?', 'is_mine' => false, 'available' => true]);

        expect(Message::query()->find($reply->json('data.id'))?->reply_to_id)->toBe($this->first->id);

        msgActAs($this->jann);
        $this->getJson("/api/v1/conversations/{$this->id}/messages")->assertOk()
            ->assertJsonPath('data.0.reply_to.id', $this->first->id)
            ->assertJsonPath('data.0.reply_to.is_mine', true)
            ->assertJsonPath('data.1.reply_to', null);
    });

    it('refuses a message the sender cannot see: another conversation, unknown, deleted for the sender, removed', function (Closure $target) {
        msgActAs($this->lukas);

        rplSend($this->id, ['reply_to_id' => $target($this)])->assertUnprocessable()
            ->assertJsonPath('code', 'validation_failed')
            ->assertJsonValidationErrors('reply_to_id');
        expect(Message::withTrashed()->where('conversation_id', $this->id)->count())->toBe(1);
    })->with([
        'another conversation' => [fn ($test): string => msgStart(ntfMember('max.e46'), $test->lukas, 'Hallo')->id],
        'unknown' => [fn (): string => (string) Str::ulid()],
        'deleted for the sender' => [function ($test): string {
            msgActAs($test->lukas);
            test()->deleteJson("/api/v1/messages/{$test->first->id}")->assertNoContent();

            return $test->first->id;
        }],
        'removed' => [function ($test): string {
            $test->first->delete();

            return $test->first->id;
        }],
    ]);

    it('validates the id format', function () {
        msgActAs($this->lukas);

        rplSend($this->id, ['reply_to_id' => 'nope'])->assertUnprocessable()->assertJsonValidationErrors('reply_to_id');
    });

    it('keeps the reply but hides the quote once the reader no longer sees the quoted message', function () {
        msgActAs($this->lukas);
        $reply = rplSend($this->id, ['reply_to_id' => $this->first->id])->assertCreated();

        // Jann deletes his own message for himself: his quote goes, Lukas still sees it.
        msgActAs($this->jann);
        $this->deleteJson("/api/v1/messages/{$this->first->id}")->assertNoContent();
        $this->getJson("/api/v1/conversations/{$this->id}/messages")->assertOk()
            ->assertJsonPath('data.0.id', $reply->json('data.id'))
            ->assertJsonPath('data.0.reply_to', ['id' => $this->first->id, 'type' => 'text', 'body' => null, 'is_mine' => true, 'available' => false]);

        msgActAs($this->lukas);
        $this->getJson("/api/v1/conversations/{$this->id}/messages")->assertOk()->assertJsonPath('data.0.reply_to.available', true);

        // Removed by moderation: gone for both.
        $this->first->delete();
        $this->getJson("/api/v1/conversations/{$this->id}/messages")->assertOk()
            ->assertJsonPath('data.0.reply_to.available', false)
            ->assertJsonPath('data.0.reply_to.body', null);
    });

    it('replays a retry with the same reply and refuses the same ids with another quote', function () {
        msgActAs($this->lukas);
        $second = msgSend($this->jann, $this->id, 'Und das Fahrwerk?');
        $body = ['body' => 'Antwort', 'client_id' => (string) Str::uuid(), 'reply_to_id' => $this->first->id];

        $created = $this->withHeader('Idempotency-Key', 'reply-1')->postJson("/api/v1/conversations/{$this->id}/messages", ['type' => 'text', ...$body])->assertCreated();
        $this->withHeader('Idempotency-Key', 'reply-1')->postJson("/api/v1/conversations/{$this->id}/messages", ['type' => 'text', ...$body])
            ->assertOk()->assertHeader('Idempotency-Replayed', 'true')->assertJsonPath('data.id', $created->json('data.id'));
        $this->withHeader('Idempotency-Key', 'reply-1')->postJson("/api/v1/conversations/{$this->id}/messages", ['type' => 'text', ...$body, 'reply_to_id' => $second->id])
            ->assertStatus(409)->assertJsonPath('code', 'idempotency_key_reused');
    });

    it('needs an active participant: guests 401, others 404, a block 404', function (Closure $who, int $status) {
        $viewer = $who($this);
        msgActAs($viewer);

        rplSend($this->id, ['reply_to_id' => $this->first->id])->assertStatus($status);
    })->with([
        'guest' => [fn (): ?User => null, 401],
        'other member' => [fn (): User => User::factory()->create(), 404],
        'participant who blocked the other' => [function ($test): User {
            socBlock($test->lukas, $test->jann);

            return $test->lukas;
        }, 404],
        'participant restricted from messaging' => [function ($test): User {
            $test->lukas->forceFill(['restrictions' => ['messaging' => ['until' => null]]])->save();

            return $test->lukas;
        }, 403],
    ]);
});

describe('car reactions', function () {
    it('takes stark, sauber, tief and laut after the six, in the fixed order', function () {
        msgActAs($this->lukas);
        $this->postJson("/api/v1/messages/{$this->first->id}/reactions", ['key' => 'tief'])->assertOk()
            ->assertJsonPath('data.reactions', [['key' => 'tief', 'count' => 1, 'mine' => true]]);

        msgActAs($this->jann);
        $this->postJson("/api/v1/messages/{$this->first->id}/reactions", ['key' => 'stark'])->assertOk();
        $this->getJson("/api/v1/conversations/{$this->id}/messages")->assertOk()
            ->assertJsonPath('data.0.reactions', [['key' => 'stark', 'count' => 1, 'mine' => true], ['key' => 'tief', 'count' => 1, 'mine' => false]]);

        $this->postJson("/api/v1/messages/{$this->first->id}/reactions", ['key' => 'quietsch'])->assertUnprocessable()->assertJsonValidationErrors('key');
    });
});

describe('the shared vehicle card (DQ-1086)', function () {
    it('carries power in PS and torque for the spec line, null when unknown', function () {
        $vehicle = homeBuild($this->jann);
        $specs = new VehicleSpec(['vehicle_id' => $vehicle->id, 'torque_nm' => 650]);
        $specs->setPower(375, PowerUnit::Kw, PowerSource::Factory)->save();
        $bare = homeBuild($this->jann);
        msgActAs($this->lukas);

        rplSend($this->id, ['type' => 'vehicle', 'body' => null, 'vehicle_id' => $vehicle->id])->assertCreated()
            ->assertJsonPath('data.vehicle.power_ps', 510)
            ->assertJsonPath('data.vehicle.torque_nm', 650);
        rplSend($this->id, ['type' => 'vehicle', 'body' => null, 'vehicle_id' => $bare->id])->assertCreated()
            ->assertJsonPath('data.vehicle.power_ps', null)
            ->assertJsonPath('data.vehicle.torque_nm', null);
    });
});

describe('the partner\'s main build (DQ-1086, DQ-1096)', function () {
    it('names the main build and its cover on the inbox row and the conversation', function () {
        homeBuild($this->jann, attributes: ['is_main' => true, 'make_id' => null, 'model_id' => null, 'generation_id' => null, 'make_text' => 'BMW', 'model_text' => 'M3']);
        msgActAs($this->lukas);

        $this->getJson('/api/v1/conversations')->assertOk()
            ->assertJsonPath('data.0.other.username', 'jann.ptrs')
            ->assertJsonPath('data.0.other.main_vehicle.title', 'BMW M3')
            ->assertJsonPath('data.0.other.main_vehicle.is_sample', false)
            ->assertJsonPath('data.0.other.main_vehicle_cover.id', fn (?string $id): bool => is_string($id));
        $this->getJson("/api/v1/conversations/{$this->id}")->assertOk()
            ->assertJsonPath('data.other.main_vehicle.title', 'BMW M3');
    });

    it('leaves both null without a main build the reader may see', function () {
        $main = homeBuild($this->jann, attributes: ['is_main' => true]);
        homeBuild($this->jann, attributes: ['is_main' => false]);
        $main->forceFill(['visibility' => 'private'])->save();
        VehicleSearch::query()->whereKey($main->id)->delete();
        msgActAs($this->lukas);

        $this->getJson("/api/v1/conversations/{$this->id}")->assertOk()
            ->assertJsonPath('data.other.main_vehicle', null)
            ->assertJsonPath('data.other.main_vehicle_cover', null);
    });
});
