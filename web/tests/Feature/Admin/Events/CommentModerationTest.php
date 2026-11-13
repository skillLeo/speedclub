<?php

use App\Enums\CommentStatus;
use App\Enums\ReportTargetType;
use App\Models\AuditEvent;
use App\Models\Comment;
use App\Models\ModerationCase;
use App\Models\User;
use Illuminate\Support\Facades\Queue;
use Illuminate\Testing\TestResponse;
use Inertia\Testing\AssertableInertia;
use Laravel\Sanctum\Sanctum;

require_once __DIR__.'/../M34/Helpers.php';
require_once __DIR__.'/../../Social2/Social2TestHelpers.php';

/**
 * M4.11 comments in the moderation queue (09 §8.5 "report → DSA pipeline", §10.2 SplitQueue shared by comments): a reported comment is
 * on ADM-20 under the type filter "Kommentar", ADM-21 shows it as written with where it stands (reply or not, the build's record), the
 * composer offers the member measures, and "Inhalt entfernen" takes it down — with the role matrix of ADM-20/21.
 */
const CMT_ADMIN_VIEW = ['owner', 'admin', 'moderator', 'analyst'];
const CMT_ADMIN_DECIDE = ['owner', 'admin', 'moderator'];

beforeEach(function () {
    Queue::fake();
    s2Flags(['build_comments' => true]);
    $this->owner = User::factory()->create(['username' => 'jann.ptrs']);
    $this->vehicle = publishedVehicle($this->owner);
    $this->update = s2Post($this->vehicle);
    $this->author = User::factory()->create(['username' => 'lukas.sc']);
    $parent = Comment::factory()->create(['build_update_id' => $this->update->id, 'user_id' => $this->owner->id]);
    $this->comment = Comment::factory()->create(['build_update_id' => $this->update->id, 'user_id' => $this->author->id, 'parent_id' => $parent->id, 'body' => 'Fahr das Ding lieber auf den Schrottplatz.']);

    Sanctum::actingAs($this->owner);
    $this->postJson('/api/v1/reports', ['target_type' => 'comment', 'target_id' => $this->comment->id, 'reason' => 'harassment', 'details' => 'Beleidigt mich unter meinem Update.'])->assertCreated();
    app('auth')->forgetGuards();
    $this->case = ModerationCase::query()->where('target_type', ReportTargetType::Comment->value)->sole();
});

it('guards the comment case like every case: moderation.view to look, moderation.decide to decide', function () {
    assertAdminMatrix('GET', "/admin/moderation/cases/{$this->case->id}", CMT_ADMIN_VIEW, fn (TestResponse $r) => $r->assertOk()
        ->assertInertia(fn (AssertableInertia $page) => $page->component('Moderation/Case')->where('preview.kind', 'comment')));
    assertAdminMatrix('POST', "/admin/moderation/cases/{$this->case->id}/decide", CMT_ADMIN_DECIDE, fn (TestResponse $r) => expect($r->status())->toBeIn([302, 303]), adm34Decision('no_action'));
});

it('lists the comment under the type filter and shows it as written, with where it stands', function () {
    adm34As('moderator');

    $this->get('/admin/moderation/reports?filter[target_type]=comment')->assertOk()->assertInertia(fn (AssertableInertia $page) => $page->component('Moderation/Reports')
        ->has('rows.data', 1)
        ->where('rows.data.0.target_type', 'comment')
        ->where('rows.data.0.target_label', '@lukas.sc'));
    $this->get('/admin/moderation/reports?filter[target_type]=vehicle')->assertOk()->assertInertia(fn (AssertableInertia $page) => $page->has('rows.data', 0));

    $this->get("/admin/moderation/cases/{$this->case->id}")->assertOk()->assertInertia(fn (AssertableInertia $page) => $page->component('Moderation/Case')
        ->where('case.target_type', 'comment')
        ->where('preview.kind', 'comment')
        ->where('preview.body', 'Fahr das Ding lieber auf den Schrottplatz.')
        ->where('preview.reply', true)
        ->where('preview.vehicle_id', $this->vehicle->id)
        ->where('preview.status', 'visible')
        ->where('messageCase', false)
        ->where('composer.actions', ['no_action', 'remove_content', 'restrict', 'suspend']));
});

it('takes the comment down with "Inhalt entfernen", audited, and keeps it out of the thread', function () {
    adm34As('moderator');

    $this->post("/admin/moderation/cases/{$this->case->id}/decide", adm34Decision('remove_content'))->assertSessionHas('success', 'moderation.flash.decided');

    expect($this->comment->fresh()?->status)->toBe(CommentStatus::Removed)
        ->and(AuditEvent::query()->where('action', 'like', 'moderation.%')->where('actor_type', 'staff')->exists())->toBeTrue();
    $this->get("/admin/moderation/cases/{$this->case->id}")->assertOk()->assertInertia(fn (AssertableInertia $page) => $page->where('preview.status', 'removed'));
    $this->getJson("/api/v1/build-updates/{$this->update->id}/comments")->assertOk()->assertJsonMissing(['body' => 'Fahr das Ding lieber auf den Schrottplatz.']);
});
