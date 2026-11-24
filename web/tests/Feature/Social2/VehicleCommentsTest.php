<?php

use App\Enums\CommentStatus;
use App\Enums\KeywordList;
use App\Enums\NotificationType;
use App\Enums\ReportTargetType;
use App\Enums\RestrictionType;
use App\Enums\VehicleStatus;
use App\Enums\Visibility;
use App\Models\Comment;
use App\Models\KeywordRule;
use App\Models\ModerationCase;
use App\Models\Notification;
use App\Models\Staff;
use App\Models\User;
use App\Services\DataExport\ExportContents;
use App\Services\Moderation\CaseRecord;
use App\Services\Moderation\ContentRemoval;
use App\Services\Notifications\NotificationFeed;
use App\Services\Notifications\NotificationTexts;
use App\Services\Notifications\Notifier;
use App\Services\Rules\KeywordNormaliser;
use App\Services\Rules\KeywordRules;
use App\Services\Search\VehicleSearchProjector;
use Illuminate\Support\Facades\Queue;
use Inertia\Testing\AssertableInertia;
use Laravel\Sanctum\Sanctum;

require_once __DIR__.'/Social2TestHelpers.php';
require_once __DIR__.'/../Admin/M34/Helpers.php';

/**
 * R5-5 (client round 5: "like or comment directly in the Home feed"): comments on the car itself [build_comments], next to an update's
 * thread and under the same rules: GET/POST vehicles/{vehicle}/comments, DELETE comments/{comment}, the owner's switch, notifications,
 * moderation (ADM-60, DSA reports), deletion and the data export. Never a count.
 */
beforeEach(function () {
    s2Flags(['build_comments' => true]);
    $this->owner = User::factory()->create(['username' => 'jann.ptrs']);
    $this->vehicle = publishedVehicle($this->owner);
    $this->fan = User::factory()->create(['username' => 'lukas.sc']);
});

function s2CarCommentUrl(string $vehicle): string
{
    return "/api/v1/vehicles/$vehicle/comments";
}

describe('reading and writing', function () {
    it('answers 404 feature_disabled while the flag is off', function () {
        s2Flags(['build_comments' => false]);
        Sanctum::actingAs($this->fan);

        $this->getJson(s2CarCommentUrl($this->vehicle->id))->assertNotFound()->assertJsonPath('code', 'feature_disabled');
        $this->postJson(s2CarCommentUrl($this->vehicle->id), ['body' => 'Hallo'])->assertNotFound()->assertJsonPath('code', 'feature_disabled');
    });

    it('comments on the car, replies one level deep and lists the thread without a count', function () {
        Sanctum::actingAs($this->fan);
        $top = $this->postJson(s2CarCommentUrl($this->vehicle->id), ['body' => 'Welche Felgen sind das?'])->assertCreated()
            ->assertJsonPath('data.on', 'vehicle')
            ->assertJsonPath('data.vehicle_id', $this->vehicle->id)
            ->assertJsonPath('data.build_update_id', null)
            ->assertJsonPath('data.can_delete', true)
            ->json('data.id');

        Sanctum::actingAs($this->owner);
        $reply = $this->postJson(s2CarCommentUrl($this->vehicle->id), ['body' => 'BBS LM, 19 Zoll.', 'parent_id' => $top])->assertCreated()->json('data.id');
        Sanctum::actingAs($this->fan);
        $deeper = $this->postJson(s2CarCommentUrl($this->vehicle->id), ['body' => 'Danke!', 'parent_id' => strtoupper($reply)])->assertCreated();
        expect($deeper->json('data.parent_id'))->toBe($top);

        $list = $this->getJson(s2CarCommentUrl($this->vehicle->id))->assertOk()->assertJsonCount(1, 'data')->assertJsonCount(2, 'data.0.replies')
            ->assertJsonPath('data.0.can_delete', true)
            ->assertJsonPath('data.0.replies.0.can_delete', false);
        expect(array_filter(s2Keys($list->json()), fn (string $key): bool => str_contains($key, 'count')))->toBe([]);

        // The update thread stays apart.
        $update = s2Post($this->vehicle);
        $this->getJson("/api/v1/build-updates/{$update->id}/comments")->assertOk()->assertJsonCount(0, 'data');
    });

    it('lets the owner comment on their own car', function () {
        Sanctum::actingAs($this->owner);

        $this->postJson(s2CarCommentUrl($this->vehicle->id), ['body' => 'Fragen gern hier rein.'])->assertCreated()->assertJsonPath('data.author.username', 'jann.ptrs');
        expect(Notification::query()->where('type', NotificationType::Comment)->count())->toBe(0);
    });

    it('validates the text, the thread of the reply and the keyword rules', function () {
        Sanctum::actingAs($this->fan);
        $url = s2CarCommentUrl($this->vehicle->id);

        $this->postJson($url, [])->assertUnprocessable()->assertJsonValidationErrors('body');
        $this->postJson($url, ['body' => str_repeat('a', 501)])->assertUnprocessable()->assertJsonValidationErrors('body');
        $this->postJson($url, ['body' => 'x', 'parent_id' => '01JAAAAAAAAAAAAAAAAAAAAAAA'])->assertUnprocessable()->assertJsonValidationErrors('parent_id');

        // A reply joins its own thread only: not an update's, not another car's.
        $updateComment = Comment::factory()->create(['build_update_id' => s2Post($this->vehicle)->id]);
        $otherCar = Comment::factory()->onVehicle(publishedVehicle())->create();
        $this->postJson($url, ['body' => 'x', 'parent_id' => $updateComment->id])->assertUnprocessable()->assertJsonValidationErrors('parent_id');
        $this->postJson($url, ['body' => 'x', 'parent_id' => $otherCar->id])->assertUnprocessable()->assertJsonValidationErrors('parent_id');

        $rule = new KeywordRule;
        $rule->forceFill(['term' => 'schrottkarre', 'normalized' => KeywordNormaliser::term('schrottkarre'), 'list' => KeywordList::Block])->save();
        app(KeywordRules::class)->flush();
        $this->postJson($url, ['body' => 'Was für eine Schrottkarre'])->assertUnprocessable()->assertJsonPath('code', 'content_blocked');

        expect(Comment::query()->where('vehicle_id', $this->vehicle->id)->count())->toBe(0);
    });

    it('keeps one thread per comment', function () {
        expect(fn () => Comment::factory()->create(['build_update_id' => null, 'vehicle_id' => null]))->toThrow(LogicException::class)
            ->and(fn () => Comment::factory()->create(['build_update_id' => s2Post($this->vehicle)->id, 'vehicle_id' => $this->vehicle->id]))->toThrow(LogicException::class);
    });

    it('applies the authorisation matrix for writing', function (Closure $who, int $status, ?string $code) {
        socActAs($who($this->owner));

        $response = $this->postJson(s2CarCommentUrl($this->vehicle->id), ['body' => 'Stark!'])->assertStatus($status);

        if ($code !== null) {
            $response->assertJsonPath('code', $code);
        }
    })->with(socMatrix([
        'guest' => [401, 'unauthenticated'],
        'other member' => [201, null],
        'unverified member' => [403, 'email_not_verified'],
        'member restricted from publishing' => [403, 'account_restricted'],
        'member restricted from messaging' => [201, null],
        'suspended member' => [403, 'account_restricted'],
        'deactivated member' => [403, 'forbidden'],
        'member who blocked the other' => [404, 'not_found'],
        'member the other blocked' => [404, 'not_found'],
    ]));

    it('applies the authorisation matrix for reading', function (Closure $who, int $status, ?string $code) {
        Comment::factory()->onVehicle($this->vehicle)->create(['user_id' => $this->fan->id]);
        socActAs($who($this->owner));

        $response = $this->getJson(s2CarCommentUrl($this->vehicle->id))->assertStatus($status);

        if ($code !== null) {
            $response->assertJsonPath('code', $code);
        }
    })->with(socMatrix([
        'guest' => [200, null],
        'other member' => [200, null],
        'unverified member' => [200, null],
        'member restricted from publishing' => [200, null],
        'member restricted from messaging' => [200, null],
        'suspended member' => [200, null],
        'deactivated member' => [200, null],
        'member who blocked the other' => [404, 'not_found'],
        'member the other blocked' => [404, 'not_found'],
    ]));

    it('refuses staff on the member API', function () {
        $this->actingAs(Staff::factory()->create(), 'staff')->postJson(s2CarCommentUrl($this->vehicle->id), ['body' => 'Hallo'])->assertUnauthorized();
    });

    it('follows the owner\'s switch: no new comments, the thread stays readable', function () {
        Comment::factory()->onVehicle($this->vehicle)->create(['user_id' => $this->fan->id]);
        Sanctum::actingAs($this->owner);
        $this->patchJson("/api/v1/vehicles/{$this->vehicle->id}/comments", ['enabled' => false])->assertOk()->assertJsonPath('data.comments_enabled', false);

        Sanctum::actingAs($this->fan);
        $this->postJson(s2CarCommentUrl($this->vehicle->id), ['body' => 'Hallo'])->assertForbidden()->assertJsonPath('code', 'comments_disabled');
        $this->getJson(s2CarCommentUrl($this->vehicle->id))->assertOk()->assertJsonCount(1, 'data');
    });

    it('hides a private build and refuses a draft', function () {
        $this->vehicle->forceFill(['visibility' => Visibility::Private])->save();
        Sanctum::actingAs($this->fan);
        $this->getJson(s2CarCommentUrl($this->vehicle->id))->assertNotFound()->assertJsonPath('code', 'not_found');
        $this->postJson(s2CarCommentUrl($this->vehicle->id), ['body' => 'Hallo'])->assertNotFound();

        // The owner still reads and writes on their private build.
        Sanctum::actingAs($this->owner);
        $this->getJson(s2CarCommentUrl($this->vehicle->id))->assertOk();
        $this->postJson(s2CarCommentUrl($this->vehicle->id), ['body' => 'Notiz für mich'])->assertCreated();

        $draft = publishedVehicle($this->owner, ['status' => VehicleStatus::Draft]);
        $this->postJson(s2CarCommentUrl($draft->id), ['body' => 'Hallo'])->assertForbidden();
    });

    it('leaves out removed comments, blocked authors and hidden samples', function () {
        Comment::factory()->onVehicle($this->vehicle)->create(['user_id' => $this->fan->id]);
        Comment::factory()->onVehicle($this->vehicle)->removed()->create();
        $blocked = User::factory()->create();
        Comment::factory()->onVehicle($this->vehicle)->create(['user_id' => $blocked->id]);
        socBlock($this->owner, $blocked);
        Comment::factory()->onVehicle($this->vehicle)->create(['user_id' => User::factory()->create(['is_sample' => true])->id]);

        $this->getJson(s2CarCommentUrl($this->vehicle->id))->assertOk()->assertJsonCount(2, 'data');
        Sanctum::actingAs($this->owner);
        $this->getJson(s2CarCommentUrl($this->vehicle->id))->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.can_delete', true);
    });

    it('pages with a cursor', function () {
        foreach (range(1, 3) as $minute) {
            Comment::factory()->onVehicle($this->vehicle)->create(['created_at' => now()->subMinutes(10 - $minute)]);
        }

        $first = $this->getJson(s2CarCommentUrl($this->vehicle->id).'?per_page=2')->assertOk()->assertJsonCount(2, 'data');
        $cursor = $first->json('meta.next_cursor');
        expect($cursor)->toBeString();
        $this->getJson(s2CarCommentUrl($this->vehicle->id).'?per_page=2&cursor='.$cursor)->assertOk()->assertJsonCount(1, 'data');
        $this->getJson(s2CarCommentUrl($this->vehicle->id).'?cursor=kaputt')->assertUnprocessable()->assertJsonValidationErrors('cursor');
    });

    it('is rate-limited', function () {
        socLimit('comments');
        Sanctum::actingAs($this->fan);

        $this->postJson(s2CarCommentUrl($this->vehicle->id), ['body' => 'eins'])->assertCreated();
        $this->postJson(s2CarCommentUrl($this->vehicle->id), ['body' => 'zwei'])->assertStatus(429);
    });

    it('replays an Idempotency-Key', function () {
        Sanctum::actingAs($this->fan);

        $first = $this->postJson(s2CarCommentUrl($this->vehicle->id), ['body' => 'Einmal'], ['Idempotency-Key' => 'car-comment-1'])->assertCreated()->json('data.id');
        expect($this->postJson(s2CarCommentUrl($this->vehicle->id), ['body' => 'Einmal'], ['Idempotency-Key' => 'car-comment-1'])->json('data.id'))->toBe($first)
            ->and(Comment::query()->where('vehicle_id', $this->vehicle->id)->count())->toBe(1);
    });
});

describe('deleting', function () {
    it('is deleted by its author or the car\'s owner, nobody else, with its replies', function () {
        $comment = Comment::factory()->onVehicle($this->vehicle)->create(['user_id' => $this->fan->id]);
        $reply = Comment::factory()->onVehicle($this->vehicle)->create(['parent_id' => $comment->id]);

        Sanctum::actingAs(User::factory()->create());
        $this->deleteJson("/api/v1/comments/{$comment->id}")->assertForbidden();

        Sanctum::actingAs($this->owner);
        $this->deleteJson("/api/v1/comments/{$comment->id}")->assertNoContent();
        expect($comment->fresh()->trashed())->toBeTrue()->and($reply->fresh()->trashed())->toBeTrue();

        $own = Comment::factory()->onVehicle($this->vehicle)->create(['user_id' => $this->fan->id]);
        Sanctum::actingAs($this->fan);
        $this->deleteJson("/api/v1/comments/{$own->id}")->assertNoContent();
    });

    it('goes with the car, stays when an update goes and goes with its author', function () {
        $update = s2Post($this->vehicle);
        $onCar = Comment::factory()->onVehicle($this->vehicle)->create(['user_id' => $this->fan->id]);
        Comment::factory()->create(['build_update_id' => $update->id, 'user_id' => $this->fan->id]);

        Sanctum::actingAs($this->owner);
        $this->deleteJson("/api/v1/build-updates/{$update->id}")->assertNoContent();
        expect(Comment::withTrashed()->whereKey($onCar->id)->exists())->toBeTrue()
            ->and(Comment::withTrashed()->where('build_update_id', $update->id)->exists())->toBeFalse();

        $other = Comment::factory()->onVehicle($this->vehicle)->create();
        $other->user->forceDelete();
        expect(Comment::withTrashed()->whereKey($other->id)->exists())->toBeFalse();

        $this->vehicle->forceDelete();
        expect(Comment::withTrashed()->whereKey($onCar->id)->exists())->toBeFalse();
    });

    it('closes the thread of a deleted car', function () {
        Comment::factory()->onVehicle($this->vehicle)->create();
        $this->vehicle->delete();

        $this->getJson(s2CarCommentUrl($this->vehicle->id))->assertNotFound();
    });
});

describe('notifications', function () {
    it('tells the owner once a day per car and the member replied to, with the car as target', function () {
        Sanctum::actingAs($this->fan);
        $top = $this->postJson(s2CarCommentUrl($this->vehicle->id), ['body' => 'Welche Federn?'])->assertCreated()->json('data.id');
        $third = User::factory()->create(['username' => 'mara.gt']);
        Sanctum::actingAs($third);
        $this->postJson(s2CarCommentUrl($this->vehicle->id), ['body' => 'Würde mich auch interessieren', 'parent_id' => $top])->assertCreated();

        $ownerRows = Notification::query()->where('notifiable_id', $this->owner->id)->where('type', NotificationType::Comment)->get();
        expect($ownerRows)->toHaveCount(1)
            ->and($ownerRows->sole()->vehicle_id)->toBe($this->vehicle->id)
            ->and($ownerRows->sole()->data['target'])->toBe('vehicle')
            ->and($ownerRows->sole()->data['update_id'])->toBeNull()
            ->and(Notification::query()->where('notifiable_id', $this->fan->id)->where('type', NotificationType::Comment)->sole()->data['reply'])->toBeTrue();

        app('auth')->forgetGuards();
        Sanctum::actingAs($this->owner);
        $this->getJson('/api/v1/notifications')->assertOk()
            ->assertJsonPath('data.0.type', 'comment')
            ->assertJsonPath('data.0.details.target', 'vehicle')
            ->assertJsonPath('data.0.details.update_id', null)
            ->assertJsonPath('data.0.details.reply', false)
            ->assertJsonPath('data.0.vehicle.id', $this->vehicle->id)
            ->assertJsonPath('data.0.actor_count', 2);
    });

    it('pushes a text about the build and opens VEH-01 with its comments', function () {
        $this->owner->forceFill(['locale' => 'de'])->save();
        $comment = Comment::factory()->onVehicle($this->vehicle)->create(['user_id' => $this->fan->id]);
        app(Notifier::class)->comment($this->owner, $this->fan, $this->vehicle, null, $comment, reply: false);

        $row = Notification::query()->where('notifiable_id', $this->owner->id)->sole();
        $shown = app(NotificationFeed::class)->find($this->owner, $row->id);

        expect(app(NotificationTexts::class)->path($shown))->toBe("/v/{$this->vehicle->slug}?comments=1")
            ->and(app(NotificationTexts::class)->push($shown, $this->owner)['body'] ?? null)->toStartWith('@lukas.sc hat deinen Build')
            ->and(app(NotificationTexts::class)->push($shown, $this->owner)['body'] ?? null)->not->toContain($comment->body);
    });

    it('keeps the car\'s row apart from an update\'s row', function () {
        $update = s2Post($this->vehicle);
        Sanctum::actingAs($this->fan);
        $this->postJson(s2CarCommentUrl($this->vehicle->id), ['body' => 'Am Auto'])->assertCreated();
        $this->postJson("/api/v1/build-updates/{$update->id}/comments", ['body' => 'Am Update'])->assertCreated();

        $targets = Notification::query()->where('notifiable_id', $this->owner->id)->where('type', NotificationType::Comment)->get()->map(fn (Notification $row) => $row->data['target'])->sort()->values()->all();
        expect($targets)->toBe(['build_update', 'vehicle']);
    });

    it('tells a mentioned member who can see the car', function () {
        $mara = User::factory()->create(['username' => 'mara.gt']);
        Sanctum::actingAs($this->fan);

        $this->postJson(s2CarCommentUrl($this->vehicle->id), ['body' => 'Schau mal @mara.gt'])->assertCreated()
            ->assertJsonPath('data.mentions.0.username', 'mara.gt');

        $row = Notification::query()->where('notifiable_id', $mara->id)->where('type', NotificationType::Mention)->sole();
        expect($row->data['target'])->toBe('vehicle')->and($row->data['update_id'])->toBeNull()->and($row->data['comment_id'])->toBeString();
    });
});

describe('feed and vehicle page', function () {
    it('tells a card and VEH-01 whether the thread is open and the reader may write, never a count', function () {
        $this->getJson("/api/v1/public/vehicles/{$this->vehicle->slug}")->assertOk()
            ->assertJsonPath('data.comment_thread', ['enabled' => true, 'can_write' => false]);

        Sanctum::actingAs($this->fan);
        $this->getJson("/api/v1/public/vehicles/{$this->vehicle->slug}")->assertJsonPath('data.comment_thread', ['enabled' => true, 'can_write' => true]);

        $this->vehicle->forceFill(['comments_enabled' => false])->save();
        $this->getJson("/api/v1/public/vehicles/{$this->vehicle->slug}")->assertJsonPath('data.comment_thread', ['enabled' => false, 'can_write' => false]);

        s2Flags(['build_comments' => false]);
        $this->vehicle->forceFill(['comments_enabled' => true])->save();
        $this->getJson("/api/v1/public/vehicles/{$this->vehicle->slug}")->assertJsonPath('data.comment_thread.enabled', false);
    });

    it('puts the thread state on a feed card', function () {
        app(VehicleSearchProjector::class)->rebuild($this->vehicle->id);
        Sanctum::actingAs(User::factory()->restrictedFrom(RestrictionType::Publishing)->create());

        $card = collect($this->getJson('/api/v1/home/new-builds')->assertOk()->json('data'))->firstWhere('id', $this->vehicle->id);
        expect($card)->not->toBeNull()
            ->and($card['comment_thread'])->toBe(['enabled' => true, 'can_write' => false])
            ->and($card)->not->toHaveKey('comments');
    });
});

describe('moderation and export', function () {
    beforeEach(function () {
        Queue::fake();
        $this->comment = Comment::factory()->onVehicle($this->vehicle)->create(['user_id' => $this->fan->id, 'body' => 'Fahr das Ding lieber auf den Schrottplatz.']);
    });

    it('is reportable with the car as context, and a removal decision takes it down', function () {
        Sanctum::actingAs($this->owner);
        $this->postJson('/api/v1/reports', ['target_type' => 'comment', 'target_id' => $this->comment->id, 'reason' => 'harassment', 'details' => 'Beleidigend'])->assertCreated();

        $case = ModerationCase::query()->sole();
        expect($case->target_type)->toBe(ReportTargetType::Comment)
            ->and($case->subject_id)->toBe($this->fan->id);

        $preview = app(CaseRecord::class)->preview($case);
        expect($preview['kind'])->toBe('comment')
            ->and($preview['on'])->toBe('vehicle')
            ->and($preview['vehicle_id'])->toBe($this->vehicle->id);

        app(ContentRemoval::class)->remove($case);
        expect($this->comment->fresh()->status)->toBe(CommentStatus::Removed);
        app('auth')->forgetGuards();
        $this->getJson(s2CarCommentUrl($this->vehicle->id))->assertJsonCount(0, 'data');
    });

    it('refuses a report of a comment the reporter cannot see', function () {
        $stranger = User::factory()->create();
        socBlock($this->fan, $stranger);
        Sanctum::actingAs($stranger);

        $this->postJson('/api/v1/reports', ['target_type' => 'comment', 'target_id' => $this->comment->id, 'reason' => 'harassment'])->assertNotFound();
    });

    it('lists the car comment on ADM-60 with its car', function () {
        adm34As('moderator');

        $this->get('/admin/comments')->assertOk()->assertInertia(fn (AssertableInertia $page) => $page->component('Comments/Index')
            ->has('rows.data', 1)
            ->where('rows.data.0.id', $this->comment->id)
            ->where('rows.data.0.on', 'vehicle')
            ->where('rows.data.0.vehicle_id', $this->vehicle->id));
    });

    it('is in its author\'s data export with the car', function () {
        $social = app(ExportContents::class)->documents($this->fan)['social.json'];

        expect($social['comments'])->toHaveCount(1)
            ->and($social['comments'][0]['vehicle_id'])->toBe($this->vehicle->id)
            ->and($social['comments'][0]['build_update_id'])->toBeNull()
            ->and($social['comments'][0]['body'])->toBe('Fahr das Ding lieber auf den Schrottplatz.');
    });
});
