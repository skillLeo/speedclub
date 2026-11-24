<?php

use App\Enums\XpType;
use App\Models\Badge;
use App\Models\User;
use App\Models\UserBadge;
use App\Models\XpEvent;
use App\Services\Events\EventCheckins;
use Illuminate\Support\Carbon;
use Laravel\Sanctum\Sanctum;

require_once __DIR__.'/GiftTestHelpers.php';
require_once __DIR__.'/../Events/M56TestHelpers.php';
require_once __DIR__.'/../Forum/ForumTestHelpers.php';

/**
 * SEC-P5-14 (docs/reports/security/phase-5.md, Phase 5 exit gate): the XP hooks of event check-in, forum solution and "Hilfreich" are
 * called by the real actions, by the fixed rules of 10 §16: once per source, never for one's own content, nothing for samples, nothing
 * that two fresh accounts can farm; "Treffen-Stammgast" (War bei 5 Treffen) unlocks from the check-in ledger.
 */
beforeEach(function () {
    $this->travelTo(Carbon::parse('2026-07-10 12:00', 'Europe/Berlin'));
    m56Flags();
    forumFlags();
});

function xpwPoints(User $member, XpType $type): int
{
    return (int) XpEvent::query()->where('user_id', $member->id)->where('type', $type->value)->sum('points');
}

function xpwCheckIn(User $member): void
{
    $event = evEvent(evOrganiser(), ['starts_at' => now()->subMinutes(30), 'ends_at' => now()->addHours(2)]);
    $code = app(EventCheckins::class)->currentCode($event)->code;
    app('auth')->forgetGuards();
    Sanctum::actingAs($member);
    test()->postJson("/api/v1/events/{$event->slug}/checkin", ['code' => $code])->assertCreated();
    test()->postJson("/api/v1/events/{$event->slug}/checkin", ['code' => $code])->assertOk();
}

describe('event check-in', function () {
    it('gives 40 XP per event once, and five check-ins unlock "Treffen-Stammgast"', function () {
        giftBadges();
        Badge::query()->whereKey('treffen-stammgast')->update(['active' => true]);
        $member = giftMember();

        xpwCheckIn($member);
        expect(xpwPoints($member, XpType::EventCheckin))->toBe(40)
            ->and(XpEvent::query()->where('user_id', $member->id)->where('type', XpType::EventCheckin->value)->count())->toBe(1);

        foreach (range(2, 5) as $day) {
            $this->travel(1)->days();
            xpwCheckIn($member);
        }

        expect(xpwPoints($member, XpType::EventCheckin))->toBe(200)
            ->and(UserBadge::query()->where('user_id', $member->id)->where('badge_key', 'treffen-stammgast')->exists())->toBeTrue();
    });

    it('gives a sample member nothing', function () {
        $sample = giftMember(['is_sample' => true]);
        xpwCheckIn($sample);

        expect(XpEvent::query()->count())->toBe(0);
    });
});

describe('forum solution', function () {
    it('gives the answer\'s author 30 XP once per thread; another answer of the same thread earns nothing more', function () {
        $asker = forumMember();
        $thread = forumThread($asker);
        $first = forumReply($thread, $helper = forumMember());
        $second = forumReply($thread, $other = forumMember());
        Sanctum::actingAs($asker);

        $this->putJson("/api/v1/forum/threads/{$thread->id}/solution", ['post_id' => $first->id])->assertOk();
        $this->deleteJson("/api/v1/forum/threads/{$thread->id}/solution")->assertOk();
        $this->putJson("/api/v1/forum/threads/{$thread->id}/solution", ['post_id' => $first->id])->assertOk();
        $this->putJson("/api/v1/forum/threads/{$thread->id}/solution", ['post_id' => $second->id])->assertOk();

        expect(xpwPoints($helper, XpType::ForumSolution))->toBe(30)
            ->and(xpwPoints($other, XpType::ForumSolution))->toBe(0)
            ->and(XpEvent::query()->where('type', XpType::ForumSolution->value)->count())->toBe(1);
    });

    it('gives nothing for an answer in one\'s own thread, or while the thread\'s author is inside the pre-moderation window', function () {
        $asker = forumMember();
        $thread = forumThread($asker);
        $own = forumReply($thread, $asker);
        Sanctum::actingAs($asker);
        $this->putJson("/api/v1/forum/threads/{$thread->id}/solution", ['post_id' => $own->id])->assertOk();

        $fresh = User::factory()->create(['created_at' => now()->subHour()]);
        $young = forumThread($fresh);
        $answer = forumReply($young, $helper = forumMember());
        app('auth')->forgetGuards();
        Sanctum::actingAs($fresh);
        $this->putJson("/api/v1/forum/threads/{$young->id}/solution", ['post_id' => $answer->id])->assertOk();

        expect(XpEvent::query()->where('type', XpType::ForumSolution->value)->count())->toBe(0)
            ->and(xpwPoints($helper, XpType::ForumSolution))->toBe(0);
    });
});

describe('"Hilfreich" received', function () {
    it('gives the reply\'s author 2 XP once per voter; taking it back and voting again earns nothing', function () {
        $thread = forumThread(forumMember());
        $reply = forumReply($thread, $author = forumMember());
        $voter = forumMember();
        Sanctum::actingAs($voter);

        $this->putJson("/api/v1/forum/posts/{$reply->id}/vote")->assertOk();
        $this->putJson("/api/v1/forum/posts/{$reply->id}/vote")->assertOk();
        $this->deleteJson("/api/v1/forum/posts/{$reply->id}/vote")->assertOk();
        $this->putJson("/api/v1/forum/posts/{$reply->id}/vote")->assertOk();

        expect(xpwPoints($author, XpType::HelpfulReceived))->toBe(2)
            ->and(XpEvent::query()->where('type', XpType::HelpfulReceived->value)->count())->toBe(1);

        app('auth')->forgetGuards();
        Sanctum::actingAs(forumMember());
        $this->putJson("/api/v1/forum/posts/{$reply->id}/vote")->assertOk();
        expect(xpwPoints($author, XpType::HelpfulReceived))->toBe(4);
    });

    it('gives nothing for one\'s own reply, nor for the vote of an account inside the pre-moderation window', function () {
        $thread = forumThread(forumMember());
        $reply = forumReply($thread, $author = forumMember());

        Sanctum::actingAs($author);
        $this->putJson("/api/v1/forum/posts/{$reply->id}/vote")->assertUnprocessable()->assertJsonPath('code', 'own_content');

        app('auth')->forgetGuards();
        Sanctum::actingAs(User::factory()->create(['created_at' => now()->subHour()]));
        $this->putJson("/api/v1/forum/posts/{$reply->id}/vote")->assertOk();

        expect(XpEvent::query()->where('type', XpType::HelpfulReceived->value)->count())->toBe(0);
    });
});
