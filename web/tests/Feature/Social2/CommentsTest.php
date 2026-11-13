<?php

use App\Enums\CommentStatus;
use App\Enums\KeywordList;
use App\Enums\NotificationType;
use App\Enums\ReportTargetType;
use App\Models\Comment;
use App\Models\KeywordRule;
use App\Models\ModerationCase;
use App\Models\Notification;
use App\Models\User;
use App\Services\Moderation\ContentRemoval;
use App\Services\Rules\KeywordNormaliser;
use App\Services\Rules\KeywordRules;
use Laravel\Sanctum\Sanctum;

require_once __DIR__.'/Social2TestHelpers.php';

/**
 * M4.11 comments [build_comments] (09 §8.5): built, flag off by default; flat with one reply level, owner switch per vehicle, keyword
 * rules, rate limit, report path, notifications.
 */
beforeEach(function () {
    s2Flags(['build_comments' => true]);
    $this->owner = User::factory()->create(['username' => 'jann.ptrs']);
    $this->vehicle = publishedVehicle($this->owner);
    $this->update = s2Post($this->vehicle);
    $this->fan = User::factory()->create(['username' => 'lukas.sc']);
});

function s2CommentUrl(string $update): string
{
    return "/api/v1/build-updates/$update/comments";
}

it('answers 404 feature_disabled on every route while the flag is off', function () {
    s2Flags(['build_comments' => false]);
    $comment = Comment::factory()->create(['build_update_id' => $this->update->id, 'user_id' => $this->fan->id]);
    Sanctum::actingAs($this->fan);

    $this->getJson(s2CommentUrl($this->update->id))->assertNotFound()->assertJsonPath('code', 'feature_disabled');
    $this->postJson(s2CommentUrl($this->update->id), ['body' => 'Hallo'])->assertNotFound()->assertJsonPath('code', 'feature_disabled');
    $this->deleteJson("/api/v1/comments/{$comment->id}")->assertNotFound();
    $this->patchJson("/api/v1/vehicles/{$this->vehicle->id}/comments", ['enabled' => false])->assertNotFound();
});

it('comments, replies one level deep and tells the owner and the member replied to', function () {
    Sanctum::actingAs($this->fan);
    $top = $this->postJson(s2CommentUrl($this->update->id), ['body' => 'Welche Federn?'])->assertCreated()->json('data.id');

    $third = User::factory()->create(['username' => 'mara.gt']);
    Sanctum::actingAs($third);
    $reply = $this->postJson(s2CommentUrl($this->update->id), ['body' => 'Gute Frage', 'parent_id' => $top])->assertCreated()->json('data.id');
    $deeper = $this->postJson(s2CommentUrl($this->update->id), ['body' => 'Noch tiefer', 'parent_id' => $reply])->assertCreated();
    expect($deeper->json('data.parent_id'))->toBe($top);

    $this->getJson(s2CommentUrl($this->update->id))->assertOk()->assertJsonCount(1, 'data')->assertJsonCount(2, 'data.0.replies');

    expect(Notification::query()->where('notifiable_id', $this->owner->id)->where('type', NotificationType::Comment)->count())->toBe(1)
        ->and(Notification::query()->where('notifiable_id', $this->fan->id)->where('type', NotificationType::Comment)->sole()->data['reply'])->toBeTrue();
});

it('validates, applies keyword rules and the vehicle switch', function () {
    Sanctum::actingAs($this->fan);
    $this->postJson(s2CommentUrl($this->update->id), ['body' => str_repeat('a', 501)])->assertUnprocessable()->assertJsonValidationErrors('body');
    $this->postJson(s2CommentUrl($this->update->id), ['body' => 'x', 'parent_id' => '01JAAAAAAAAAAAAAAAAAAAAAAA'])->assertUnprocessable()->assertJsonValidationErrors('parent_id');

    $rule = new KeywordRule;
    $rule->forceFill(['term' => 'schrottkarre', 'normalized' => KeywordNormaliser::term('schrottkarre'), 'list' => KeywordList::Block])->save();
    app(KeywordRules::class)->flush();
    $this->postJson(s2CommentUrl($this->update->id), ['body' => 'Was für eine Schrottkarre'])->assertUnprocessable()->assertJsonPath('code', 'content_blocked');

    Sanctum::actingAs($this->owner);
    $this->patchJson("/api/v1/vehicles/{$this->vehicle->id}/comments", ['enabled' => false])->assertOk()->assertJsonPath('data.comments_enabled', false);
    Sanctum::actingAs($this->fan);
    $this->postJson(s2CommentUrl($this->update->id), ['body' => 'Hallo'])->assertForbidden()->assertJsonPath('code', 'comments_disabled');
});

it('applies the authorisation matrix for writing', function (Closure $who, int $status, ?string $code) {
    socActAs($who($this->owner));

    $response = $this->postJson(s2CommentUrl($this->update->id), ['body' => 'Stark!'])->assertStatus($status);

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

it('lists for guests, without removed comments or members the viewer may not see', function () {
    Comment::factory()->create(['build_update_id' => $this->update->id, 'user_id' => $this->fan->id]);
    Comment::factory()->removed()->create(['build_update_id' => $this->update->id]);
    $blocked = User::factory()->create();
    Comment::factory()->create(['build_update_id' => $this->update->id, 'user_id' => $blocked->id]);
    socBlock($this->owner, $blocked);

    $this->getJson(s2CommentUrl($this->update->id))->assertOk()->assertJsonCount(2, 'data');
    Sanctum::actingAs($this->owner);
    $this->getJson(s2CommentUrl($this->update->id))->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.can_delete', true);
});

it('is deleted by its author or the update\'s owner, nobody else', function () {
    $comment = Comment::factory()->create(['build_update_id' => $this->update->id, 'user_id' => $this->fan->id]);
    Sanctum::actingAs(User::factory()->create());
    $this->deleteJson("/api/v1/comments/{$comment->id}")->assertForbidden();

    Sanctum::actingAs($this->owner);
    $this->deleteJson("/api/v1/comments/{$comment->id}")->assertNoContent();
    expect($comment->fresh()->trashed())->toBeTrue();
});

it('is reportable, and a removal decision takes it down', function () {
    $comment = Comment::factory()->create(['build_update_id' => $this->update->id, 'user_id' => $this->fan->id]);
    Sanctum::actingAs($this->owner);

    $this->postJson('/api/v1/reports', ['target_type' => 'comment', 'target_id' => $comment->id, 'reason' => 'harassment', 'details' => 'Beleidigend'])->assertCreated();
    $case = ModerationCase::query()->sole();
    expect($case->target_type)->toBe(ReportTargetType::Comment);

    app(ContentRemoval::class)->remove($case);
    expect($comment->fresh()->status)->toBe(CommentStatus::Removed);
    app('auth')->forgetGuards();
    $this->getJson(s2CommentUrl($this->update->id))->assertJsonCount(0, 'data');
});

it('is rate-limited', function () {
    socLimit('comments');
    Sanctum::actingAs($this->fan);

    $this->postJson(s2CommentUrl($this->update->id), ['body' => 'eins'])->assertCreated();
    $this->postJson(s2CommentUrl($this->update->id), ['body' => 'zwei'])->assertStatus(429);
});
