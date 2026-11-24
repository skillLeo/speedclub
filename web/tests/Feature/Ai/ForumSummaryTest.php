<?php

use App\Actions\Admin\Forum\HideForumPost;
use App\Enums\AiFeature;
use App\Enums\ForumPostStatus;
use App\Enums\GroundDocument;
use App\Enums\KeywordList;
use App\Models\FeatureFlag;
use App\Models\ForumThread;
use App\Models\ForumThreadSummary;
use App\Models\KeywordRule;
use App\Models\Staff;
use App\Models\User;
use App\Services\Ai\Agents\ForumSummaryAgent;
use App\Services\Ai\ForumSummaries;
use App\Services\AppConfig\FeatureFlags;
use App\Services\Moderation\Statement;
use App\Services\Rules\KeywordNormaliser;
use App\Services\Rules\KeywordRules;
use Database\Seeders\StaffSeeder;
use Illuminate\Testing\TestResponse;
use Laravel\Ai\Prompts\AgentPrompt;
use Laravel\Sanctum\Sanctum;

require_once __DIR__.'/AiTestHelpers.php';
require_once __DIR__.'/../Forum/ForumTestHelpers.php';

/**
 * M5.9 forum summary (10 §8.4, m5.9-contract §2.3, lead D-3): built in the background for threads with more than 20 visible replies, from
 * public post text without names, mentions, links or photos; labelled "KI-Zusammenfassung"; hidden from a reader with a block on a
 * contributing author; dropped when a used post goes; refreshed after 10 new replies.
 */
beforeEach(function () {
    forumFlags();
    aiOn(AiFeature::ForumSummary);
    $this->author = forumMember(['username' => 'schrauber.sven', 'display_name' => 'Sven Schrauber']);
    $this->thread = forumThread($this->author, ['title' => 'Gewindefahrwerk zu hart?']);
    $this->repliers = collect(range(1, 21))->map(fn (int $i) => forumMember(['username' => 'helfer'.$i]));
    $this->replies = $this->repliers->map(fn (User $member, int $i) => forumReply($this->thread, $member, ['body' => "Probier mal die Zugstufe weicher, Antwort $i. Frag @schrauber.sven https://example.com/tipp"]));
});

const SUMMARY_LINES = ['Es geht um ein zu hartes Gewindefahrwerk.', 'Die meisten raten, die Zugstufe weicher zu stellen.', 'Eine Lösung ist noch offen.'];

function summaryRun(): ?int
{
    return app(ForumSummaries::class)->run();
}

function summaryRead(ForumThread $thread, ?User $reader = null): TestResponse
{
    app('auth')->forgetGuards();

    if ($reader !== null) {
        Sanctum::actingAs($reader);
    }

    return test()->getJson("/api/v1/forum/threads/{$thread->id}", ['Accept-Language' => 'de']);
}

it('summarises a long thread from public text only and shows it labelled', function () {
    ForumSummaryAgent::fake([['refused' => false, 'lines' => SUMMARY_LINES]]);

    expect(summaryRun())->toBe(1);

    ForumSummaryAgent::assertPrompted(fn (AgentPrompt $prompt): bool => $prompt->contains('Gewindefahrwerk zu hart?')
        && $prompt->contains('Zugstufe weicher') && $prompt->contains('ein Mitglied')
        && ! $prompt->contains('schrauber.sven') && ! $prompt->contains('Sven Schrauber') && ! $prompt->contains('helfer1') && ! $prompt->contains('example.com'));

    summaryRead($this->thread)->assertOk()
        ->assertJsonPath('data.ai_summary.label', 'KI-Zusammenfassung')
        ->assertJsonPath('data.ai_summary.lines', SUMMARY_LINES)
        ->assertJsonPath('data.ai_summary.based_on_replies', 21);

    // Idempotent: nothing new to do.
    expect(summaryRun())->toBe(0);
    ForumSummaryAgent::assertPromptedTimes(1);
});

it('drops lines with names, links or invented numbers and stores nothing below two lines', function () {
    ForumSummaryAgent::fake([['refused' => false, 'lines' => ['schrauber.sven fragt nach dem Fahrwerk.', 'Siehe https://example.com.', 'Es kostet 999 Euro.']]]);

    expect(summaryRun())->toBe(0)
        ->and(ForumThreadSummary::query()->count())->toBe(0)
        ->and(aiLastCall()->outcome->value)->toBe('invalid');
    summaryRead($this->thread)->assertJsonPath('data.ai_summary', null);
});

it('drops a line with a bare domain or a term of the keyword rules (SEC-P5-10)', function (string $line, ?KeywordList $list) {
    if ($list !== null) {
        $rule = new KeywordRule;
        $rule->forceFill(['term' => 'schrottkarre', 'normalized' => KeywordNormaliser::term('schrottkarre'), 'list' => $list])->save();
        app(KeywordRules::class)->flush();
    }

    ForumSummaryAgent::fake([['refused' => false, 'lines' => [SUMMARY_LINES[0], $line, SUMMARY_LINES[1]]]]);

    expect(summaryRun())->toBe(1)
        ->and(ForumThreadSummary::query()->sole()->lines)->toBe([SUMMARY_LINES[0], SUMMARY_LINES[1]]);
})->with([
    'bare domain' => ['Bestellen lohnt sich bei teile-discount.de.', null],
    'bare domain with a path' => ['Die Anleitung steht auf fahrwerk-tipps.com/zugstufe.', null],
    'block list' => ['Die Schrottkarre braucht ein weicheres Fahrwerk.', KeywordList::Block],
    'flag list' => ['Die Schrottkarre braucht ein weicheres Fahrwerk.', KeywordList::Flag],
]);

it('takes the summary down at once when staff hide a post that went into it, before the next run (SEC-P5-10)', function () {
    ForumSummaryAgent::fake([['refused' => false, 'lines' => SUMMARY_LINES]]);
    summaryRun();
    summaryRead($this->thread)->assertJsonPath('data.ai_summary.lines', SUMMARY_LINES);

    $this->seed(StaffSeeder::class);
    $moderator = Staff::factory()->create();
    $moderator->assignRole('moderator');
    $hidden = $this->replies->first();
    app(HideForumPost::class)->handle($moderator->fresh() ?? $moderator, $hidden, new Statement('Der Beitrag wirbt für einen Shop.', 'Community-Regeln', GroundDocument::Community), 'Werbung geprüft');

    expect(ForumThreadSummary::query()->count())->toBe(1);
    summaryRead($this->thread)->assertOk()->assertJsonPath('data.ai_summary', null);
});

it('leaves out short threads and refreshes after 10 new replies', function () {
    $short = forumThread(null, ['title' => 'Kurz']);
    forumReply($short);
    ForumSummaryAgent::fake([['refused' => false, 'lines' => SUMMARY_LINES], ['refused' => false, 'lines' => [...array_slice(SUMMARY_LINES, 0, 2), 'Jetzt gelöst.']]]);

    summaryRun();
    expect(ForumThreadSummary::query()->pluck('thread_id')->all())->toBe([$this->thread->id]);

    foreach (range(1, 9) as $i) {
        forumReply($this->thread);
    }
    expect(summaryRun())->toBe(0);

    forumReply($this->thread);
    expect(summaryRun())->toBe(1)
        ->and(ForumThreadSummary::query()->sole()->based_on_replies)->toBe(31);
});

it('drops the summary when a post it was built from is removed, and builds it again without it', function () {
    ForumSummaryAgent::fake([['refused' => false, 'lines' => SUMMARY_LINES], ['refused' => false, 'lines' => SUMMARY_LINES]]);
    summaryRun();
    $removed = $this->replies->first();
    $removed->forceFill(['status' => ForumPostStatus::Removed])->save();

    expect(app(ForumSummaries::class)->sweep())->toBe(1);
    summaryRead($this->thread)->assertJsonPath('data.ai_summary', null);

    summaryRun();
    expect(ForumThreadSummary::query()->sole()->post_ids)->not->toContain($removed->id);
});

it('hides it from a reader with a block on a contributing author, either way', function (bool $readerBlocks) {
    ForumSummaryAgent::fake([['refused' => false, 'lines' => SUMMARY_LINES]]);
    summaryRun();
    $reader = forumMember();
    $readerBlocks ? forumBlock($reader, $this->repliers->last()) : forumBlock($this->repliers->last(), $reader);

    summaryRead($this->thread, $reader)->assertOk()->assertJsonPath('data.ai_summary', null);
    summaryRead($this->thread, forumMember())->assertJsonPath('data.ai_summary.lines', SUMMARY_LINES);
})->with(['the reader blocked' => [true], 'the reader is blocked' => [false]]);

it('shows it to guests and members without the KI opt-in, and to nobody without the flag or a key', function () {
    ForumSummaryAgent::fake([['refused' => false, 'lines' => SUMMARY_LINES]]);
    summaryRun();

    summaryRead($this->thread)->assertJsonPath('data.ai_summary.lines', SUMMARY_LINES);
    summaryRead($this->thread, forumMember(['ai_suggestions' => false]))->assertJsonPath('data.ai_summary.lines', SUMMARY_LINES);

    FeatureFlag::query()->where('key', 'ai.forum_summary')->update(['enabled' => false]);
    app()->forgetInstance(FeatureFlags::class);
    summaryRead($this->thread)->assertJsonPath('data.ai_summary', null);

    FeatureFlag::query()->where('key', 'ai.forum_summary')->update(['enabled' => true]);
    aiProvider(false);
    summaryRead($this->thread)->assertJsonPath('data.ai_summary', null);
    expect(summaryRun())->toBe(0);
});

it('stops when the budget is spent or the provider fails, and tries again later', function () {
    config(['speedclub.ai.daily_calls.forum_summary' => 0]);
    ForumSummaryAgent::fake()->preventStrayPrompts();

    expect(summaryRun())->toBe(0)->and(ForumThreadSummary::query()->count())->toBe(0);

    config(['speedclub.ai.daily_calls.forum_summary' => 300]);
    ForumSummaryAgent::fake(fn () => throw new RuntimeException('down'));
    expect(summaryRun())->toBe(0);

    ForumSummaryAgent::fake([['refused' => false, 'lines' => SUMMARY_LINES]]);
    expect(summaryRun())->toBe(1);
});

it('is scheduled every ten minutes from 06:00 to 23:50 in Germany', function () {
    require_once __DIR__.'/../Engagement/EngagementTestHelpers.php';

    expect(engScheduledAt('forum:summaries', '2026-11-17 06:00'))->toBeTrue()
        ->and(engScheduledAt('forum:summaries', '2026-11-17 23:50'))->toBeTrue()
        ->and(engScheduledAt('forum:summaries', '2026-11-17 03:00'))->toBeFalse();
});
