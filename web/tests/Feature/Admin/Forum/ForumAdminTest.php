<?php

use App\Actions\Admin\Forum\ReviewForumPost;
use App\Enums\DecisionAction;
use App\Enums\ForumPostStatus;
use App\Enums\ForumThreadStatus;
use App\Enums\NotificationType;
use App\Enums\RestrictionType;
use App\Models\AuditEvent;
use App\Models\Decision;
use App\Models\ForumCategory;
use App\Models\ForumPost;
use App\Models\Notification;
use App\Models\Staff;
use App\Models\User;
use Illuminate\Testing\TestResponse;
use Inertia\Testing\AssertableInertia;

require_once __DIR__.'/../Support/helpers.php';
require_once __DIR__.'/../../Forum/ForumTestHelpers.php';

/**
 * M5.8 ADM Forum-Moderation (+ Kategorien), m5.8-contract §6: queue props, pre-moderation approve/reject with optimistic locking, staff
 * tools (pin, lock, move, merge, solution), DSA hide and forum ban, categories; the role matrix of every route; every write audited.
 * The Vue pages exist (admin-builder, M5.8): component() checks the page file too.
 */
beforeEach(function () {
    forumFlags();
    $this->author = forumMember(['username' => 'jonas.e46']);
    $this->thread = forumThread($this->author);
});

/** A signed-in staff member of $role whose password was just confirmed (staff.recent-password). */
function forumStaff(string $role): Staff
{
    seedStaffRoles();
    $staff = staffWithRole($role);
    actingAsStaff($staff);
    test()->withSession(['auth.staff_password_confirmed_at' => time(), 'auth.password_confirmed_at' => time()]);

    return $staff;
}

function forumStatement(array $extra = []): array
{
    return ['facts' => 'Der Beitrag beleidigt ein anderes Mitglied.', 'ground' => 'Community-Regeln: respektvoller Umgang', 'ground_document' => 'community', 'reason' => 'Beleidigung nach Meldung geprüft', ...$extra];
}

it('opens the queue for moderation.view roles only', function () {
    assertAdminMatrix('GET', '/admin/forum', ['owner', 'admin', 'moderator', 'analyst'], function (TestResponse $response): void {
        $response->assertOk()->assertInertia(fn (AssertableInertia $page) => $page->component('Forum/Queue')
            ->has('rows.data')->has('counts.pending')->has('counts.reported')->where('tab', 'pending'));
    });
});

it('opens the categories for moderation.rules roles only', function () {
    assertAdminMatrix('GET', '/admin/forum/categories', ['owner', 'admin', 'moderator'], function (TestResponse $response): void {
        $response->assertOk()->assertInertia(fn (AssertableInertia $page) => $page->component('Forum/Categories')->has('categories')->where('canManage', true));
    });
});

it('shows pending posts with the reason and the selected thread', function () {
    $new = User::factory()->create(['username' => 'neu.hier']);
    $pending = forumReply($this->thread, $new, ['status' => ForumPostStatus::Pending, 'published_at' => null]);
    forumStaff('moderator');

    $this->get('/admin/forum?thread='.$this->thread->id)->assertOk()->assertInertia(fn (AssertableInertia $page) => $page
        ->component('Forum/Queue')
        ->where('rows.data.0.id', $pending->id)
        ->where('rows.data.0.kind', 'reply')
        ->where('rows.data.0.author.reason', 'new_account')
        ->where('counts.pending', 1)
        ->where('selected.thread.id', $this->thread->id)
        ->has('selected.posts', 2)
        ->where('selected.posts.0.is_opening', true)
        ->has('templates'));

    foreach (['reported', 'threads', 'removed'] as $tab) {
        $this->get("/admin/forum?tab=$tab")->assertOk()->assertInertia(fn (AssertableInertia $page) => $page->where('tab', $tab));
    }
});

it('approves a pending thread, publishes it, notifies mentions and audits; a stale version conflicts', function () {
    $new = User::factory()->create();
    $thread = forumThread($new, ['status' => ForumThreadStatus::Pending, 'published_at' => null]);
    $opening = forumOpening($thread);
    $staff = forumStaff('moderator');

    $this->from('/admin/forum')->post("/admin/forum/posts/{$opening->id}/approve", ['version' => 'alt'])->assertSessionHasErrors('version');

    $this->from('/admin/forum')->post("/admin/forum/posts/{$opening->id}/approve", ['version' => ReviewForumPost::version($opening)])
        ->assertRedirect('/admin/forum')->assertSessionHas('success', 'forum.flash.approved');

    expect($thread->refresh()->status)->toBe(ForumThreadStatus::Published)->and($opening->refresh()->status)->toBe(ForumPostStatus::Published)
        ->and(AuditEvent::query()->where('action', 'forum.post_approved')->where('actor_id', (string) $staff->id)->exists())->toBeTrue();

    // Decided already: no second decision.
    $this->from('/admin/forum')->post("/admin/forum/posts/{$opening->id}/approve", ['version' => ReviewForumPost::version($opening)])->assertSessionHasErrors('state');
});

it('rejects with a reason the author reads', function () {
    $new = User::factory()->create();
    $reply = forumReply($this->thread, $new, ['status' => ForumPostStatus::Pending, 'published_at' => null]);
    forumStaff('admin');

    $this->post("/admin/forum/posts/{$reply->id}/reject", ['version' => ReviewForumPost::version($reply)])->assertSessionHasErrors('reason');
    $this->post("/admin/forum/posts/{$reply->id}/reject", ['version' => ReviewForumPost::version($reply), 'reason' => 'Werbung für einen Shop, bitte ohne Links.'])
        ->assertSessionHas('success', 'forum.flash.rejected');

    expect($reply->refresh()->status)->toBe(ForumPostStatus::Rejected)->and($reply->review_reason)->toContain('Werbung');
});

it('lets only moderation.decide roles use the staff tools, with a recent password', function (string $role, bool $allowed) {
    forumStaff($role);
    $response = $this->post("/admin/forum/threads/{$this->thread->id}/pin", []);

    $allowed ? $response->assertSessionHas('success', 'forum.flash.pinned') : assertAdminErrorPage($response, 403);
    expect($this->thread->refresh()->is_pinned)->toBe($allowed);
})->with([
    'owner' => ['owner', true], 'admin' => ['admin', true], 'moderator' => ['moderator', true],
    'support' => ['support', false], 'content_editor' => ['content_editor', false], 'analyst' => ['analyst', false],
]);

it('asks for the password again before a staff tool', function () {
    seedStaffRoles();
    actingAsStaff(staffWithRole('moderator'));

    $this->post("/admin/forum/threads/{$this->thread->id}/lock", [])->assertRedirect();
    expect($this->thread->refresh()->is_locked)->toBeFalse();
});

it('locks, moves, merges and corrects the solution, each audited', function () {
    forumStaff('moderator');
    $target = forumThread(forumMember());
    $other = ForumCategory::factory()->create();
    $reply = forumReply($this->thread, forumMember());

    $this->post("/admin/forum/threads/{$this->thread->id}/lock", ['reason' => null])->assertSessionHas('success', 'forum.flash.locked');
    expect($this->thread->refresh()->is_locked)->toBeTrue();

    // ADR-540: the reason is optional; one over 1000 characters is still refused.
    $this->post("/admin/forum/threads/{$this->thread->id}/move", ['category_id' => $other->id, 'reason' => str_repeat('x', 1001)])->assertSessionHasErrors('reason');
    $this->post("/admin/forum/threads/{$this->thread->id}/move", ['category_id' => $other->id, 'reason' => 'Passt besser in diese Kategorie.'])->assertSessionHas('success');
    expect($this->thread->refresh()->category_id)->toBe($other->id);

    $this->post("/admin/forum/threads/{$this->thread->id}/solution", ['post_id' => $reply->id, 'reason' => 'Lösung nach Rückfrage gesetzt.'])->assertSessionHas('success');
    expect($this->thread->refresh()->solved_post_id)->toBe($reply->id);

    $this->post("/admin/forum/threads/{$this->thread->id}/merge", ['into_thread_id' => $target->id, 'reason' => 'Gleiche Frage wie im anderen Thema.'])->assertSessionHas('success', 'forum.flash.merged');
    expect($this->thread->refresh()->status)->toBe(ForumThreadStatus::Merged)->and($this->thread->merged_into_id)->toBe($target->id)
        ->and(ForumPost::query()->where('thread_id', $target->id)->count())->toBe(3)
        ->and($target->refresh()->replies_count)->toBe(2);

    foreach (['forum.thread_locked', 'forum.thread_moved', 'forum.solution_set', 'forum.thread_merged'] as $action) {
        expect(AuditEvent::query()->where('action', $action)->exists())->toBeTrue();
    }
});

it('hides a post as a DSA decision with a statement of reasons', function () {
    $reply = forumReply($this->thread, forumMember());
    forumStaff('moderator');

    $this->post("/admin/forum/posts/{$reply->id}/hide", ['reason' => str_repeat('x', 1001)])->assertSessionHasErrors(['facts', 'ground', 'reason']);
    $this->post("/admin/forum/posts/{$reply->id}/hide", forumStatement())->assertSessionHas('success', 'forum.flash.hidden');

    expect($reply->refresh()->status)->toBe(ForumPostStatus::Removed)
        ->and(Decision::query()->where('action', DecisionAction::RemoveContent->value)->where('subject_id', $reply->user_id)->exists())->toBeTrue()
        ->and(Notification::query()->where('notifiable_id', $reply->user_id)->where('type', NotificationType::ModerationDecision)->exists())->toBeTrue();
});

it('bans a member from the forum as a DSA restriction (members.restrict)', function () {
    $member = forumMember();
    forumStaff('support');
    $this->post("/admin/forum/members/{$member->id}/ban", forumStatement())->assertForbidden();

    forumStaff('moderator');
    $this->post("/admin/forum/members/{$member->id}/ban", forumStatement(['until' => now()->addWeek()->toIso8601String()]))->assertSessionHas('success', 'forum.flash.banned');

    expect($member->refresh()->isRestrictedFrom(RestrictionType::Forum))->toBeTrue()
        ->and($member->isRestrictedFrom(RestrictionType::Publishing))->toBeFalse();
});

it('manages categories: create, edit, reorder, sync, delete only when empty', function () {
    $staff = forumStaff('moderator');
    $parent = ForumCategory::factory()->create(['slug' => 'technik']);

    $this->post('/admin/forum/categories', ['slug' => 'Ungültig Slug', 'name_de' => 'x', 'name_en' => 'x'])->assertSessionHasErrors(['slug', 'name_de', 'name_en']);
    $this->post('/admin/forum/categories', ['slug' => 'getriebe', 'name_de' => 'Getriebe', 'name_en' => 'Gearbox', 'parent_id' => $parent->id])->assertSessionHas('success', 'forum.flash.category_created');
    $child = ForumCategory::query()->where('slug', 'getriebe')->sole();
    expect($child->parent_id)->toBe($parent->id);

    // One level only.
    $this->post('/admin/forum/categories', ['slug' => 'tiefer', 'name_de' => 'Tiefer', 'name_en' => 'Deeper', 'parent_id' => $child->id])->assertSessionHasErrors('parent_id');

    $this->patch("/admin/forum/categories/{$child->id}", ['name_de' => 'Getriebe & Kupplung', 'is_active' => false])->assertSessionHas('success');
    expect($child->refresh()->name_de)->toBe('Getriebe & Kupplung')->and($child->is_active)->toBeFalse();

    $second = ForumCategory::factory()->create(['parent_id' => $parent->id]);
    $this->post('/admin/forum/categories/order', ['ids' => [$second->id, $child->id]])->assertSessionHas('success');
    expect($second->refresh()->sort)->toBe(0)->and($child->refresh()->sort)->toBe(1);

    $this->post('/admin/forum/categories/sync', [])->assertSessionHas('success', 'forum.flash.categories_synced');
    expect(ForumCategory::query()->where('kind', 'region')->count())->toBe(16);

    $this->delete("/admin/forum/categories/{$this->thread->category_id}")->assertSessionHas('error');
    $this->delete("/admin/forum/categories/{$second->id}")->assertSessionHas('success', 'forum.flash.category_deleted');

    expect(AuditEvent::query()->where('action', 'forum.category_created')->where('actor_id', (string) $staff->id)->exists())->toBeTrue();
});
