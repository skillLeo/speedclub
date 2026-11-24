<?php

use App\Actions\Admin\Forum\ReviewForumPost;
use App\Actions\Admin\Members\StartViewAs;
use App\Models\EventCheckinCode;
use App\Models\ForumPost;
use App\Models\ForumThread;
use App\Models\Staff;
use App\Models\User;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Tests\Support\TestImages;

require_once __DIR__.'/../Forum/ForumTestHelpers.php';
require_once __DIR__.'/../Events/M56TestHelpers.php';
require_once __DIR__.'/../Staff/Helpers.php';

/**
 * Phase 5 exit gate, security review (docs/reports/security/phase-5.md, section "Phase 5 exit gate (M5.12)"). Each test states the
 * behaviour the fix must give; the ones of findings still open are skipped with their id and go green with the fix (remove the skip).
 */
function p5gGuest(): void
{
    app('auth')->forgetGuards();
}

/** A member inside the forum's pre-moderation window (account younger than speedclub.forum.premoderation_days). */
function p5gNewMember(): User
{
    return User::factory()->create(['created_at' => now()->subHour()]);
}

function p5gApprove(ForumPost $post): void
{
    $post = $post->fresh() ?? $post;
    app(ReviewForumPost::class)->approve(Staff::factory()->create(), $post, null, ReviewForumPost::version($post));
}

describe('SEC-P5-09 pre-moderation ends at the first approval', function () {
    beforeEach(function () {
        forumFlags();
        Storage::fake('public');
        Storage::fake('local');
        $this->thread = forumThread(forumMember());
    });

    it('never shows a guest the unreviewed edit of a new account\'s approved reply', function () {
        $new = p5gNewMember();
        Sanctum::actingAs($new);
        $id = $this->postJson("/api/v1/forum/threads/{$this->thread->id}/posts", ['body' => 'Danke, das hilft mir weiter.'])
            ->assertCreated()->assertJsonPath('data.status', 'pending')->json('data.id');

        p5gApprove(ForumPost::query()->findOrFail($id));

        Sanctum::actingAs($new);
        $this->patchJson("/api/v1/forum/posts/$id", ['body' => 'Felgen zum halben Preis: https://spam.example/kaufen'])->assertOk();

        p5gGuest();
        $this->getJson("/api/v1/forum/threads/{$this->thread->id}/posts")->assertOk()->assertDontSee('spam.example');
    });

    it('never shows a guest the unreviewed edit of a new account\'s approved thread', function () {
        $new = p5gNewMember();
        Sanctum::actingAs($new);
        $id = $this->postJson('/api/v1/forum/threads', forumThreadPayload(forumCategory()))->assertCreated()->assertJsonPath('data.status', 'pending')->json('data.id');

        p5gApprove(forumOpening(ForumThread::query()->findOrFail($id)));

        Sanctum::actingAs($new);
        $this->patchJson("/api/v1/forum/threads/$id", ['body' => 'Jetzt neu: Felgen zum halben Preis unter https://spam.example/kaufen'])->assertOk();

        p5gGuest();
        $this->getJson("/api/v1/forum/threads/$id")->assertOk()->assertDontSee('spam.example');
    });

    it('never shows a guest a photo a new account added after the approval', function () {
        $new = p5gNewMember();
        Sanctum::actingAs($new);
        $id = $this->postJson('/api/v1/forum/threads', forumThreadPayload(forumCategory()))->assertCreated()->json('data.id');

        p5gApprove(forumOpening(ForumThread::query()->findOrFail($id)));

        Sanctum::actingAs($new);
        $this->post("/api/v1/forum/threads/$id/photos", ['file' => UploadedFile::fake()->createWithContent('a.jpg', TestImages::jpeg(400, 300))], ['Accept' => 'application/json'])
            ->assertCreated();

        p5gGuest();
        $this->getJson("/api/v1/forum/threads/$id")->assertOk()->assertJsonCount(0, 'data.photos');
    });

    it('holds: an established member\'s edit stays published (control)', function () {
        $member = forumMember();
        Sanctum::actingAs($member);
        $id = $this->postJson("/api/v1/forum/threads/{$this->thread->id}/posts", ['body' => 'Erste Fassung der Antwort.'])
            ->assertCreated()->assertJsonPath('data.status', 'published')->json('data.id');
        $this->patchJson("/api/v1/forum/posts/$id", ['body' => 'Zweite Fassung der Antwort.'])->assertOk()->assertJsonPath('data.status', 'published');

        p5gGuest();
        $this->getJson("/api/v1/forum/threads/{$this->thread->id}/posts")->assertOk()->assertSee('Zweite Fassung');
    });
});

describe('SEC-P5-11 view-as GETs without side effects (Phase 5 routes)', function () {
    beforeEach(function () {
        $this->withoutDefer();
        Mail::fake();
        m56Flags();
    });

    it('issues no check-in code to a staff member in view-as of the organiser', function () {
        $organiser = evOrganiser();
        $event = evEvent($organiser, ['starts_at' => now()->subMinutes(30), 'ends_at' => now()->addHours(2)]);
        $token = app(StartViewAs::class)->handle(m31Staff('admin'), $organiser, 'Ticket 4711: mehrere Beschwerden geprüft.', false)['token'];

        $this->withToken($token)->getJson("/api/v1/events/{$event->slug}/checkin-code");

        expect(EventCheckinCode::query()->where('event_id', $event->id)->count())->toBe(0);
    });

    it('refuses the check-in code and the sticker preview and print files in view-as with view_as_private', function () {
        $organiser = evOrganiser();
        $event = evEvent($organiser, ['starts_at' => now()->subMinutes(30), 'ends_at' => now()->addHours(2)]);
        $token = app(StartViewAs::class)->handle(m31Staff('admin'), $organiser, 'Ticket 4711: mehrere Beschwerden geprüft.', false)['token'];
        $design = strtolower((string) Str::ulid());

        $this->withToken($token)->getJson("/api/v1/events/{$event->slug}/checkin-code")->assertForbidden()->assertJsonPath('code', 'view_as_private');

        foreach (['preview.svg', 'print.svg', 'print.pdf', 'print.png'] as $file) {
            $this->withToken($token)->getJson("/api/v1/sticker-designs/$design/$file")->assertForbidden()->assertJsonPath('code', 'view_as_private');
        }

        // The organiser's own token still gets the code (the guard is about view-as only).
        $this->app['auth']->forgetGuards();
        $this->withToken($organiser->createToken('phone', ['member'])->plainTextToken)->getJson("/api/v1/events/{$event->slug}/checkin-code")->assertOk();
        expect(EventCheckinCode::query()->where('event_id', $event->id)->count())->toBe(1);
    });
});

describe('SEC-P5-12 gallery limit per attendee', function () {
    it('keeps the 10-photo limit when the attendee deletes a pending photo and uploads again', function () {
        m56Flags();
        m56Disks();
        $event = m56JustEnded(evOrganiser());
        $attendee = User::factory()->create();
        m56Checkin($event, $attendee);
        Sanctum::actingAs($attendee);

        $ids = [];

        foreach (range(1, 10) as $i) {
            $ids[] = $this->post("/api/v1/events/{$event->slug}/gallery", m56Upload(), ['Accept' => 'application/json'])->assertCreated()->json('data.id');
        }

        $this->post("/api/v1/events/{$event->slug}/gallery", m56Upload(), ['Accept' => 'application/json'])->assertStatus(409);
        $this->deleteJson("/api/v1/events/{$event->slug}/gallery/{$ids[0]}")->assertNoContent();

        $this->post("/api/v1/events/{$event->slug}/gallery", m56Upload(), ['Accept' => 'application/json'])->assertStatus(409);
    });
});
