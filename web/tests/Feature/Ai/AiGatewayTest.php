<?php

use App\Enums\AiFeature;
use App\Enums\AiOutcome;
use App\Models\AiCall;
use App\Models\AiTranslation;
use App\Services\Ai\Agents\SearchInterpreterAgent;
use App\Services\Ai\AiFailed;
use App\Services\Ai\AiGateway;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Laravel\Ai\Exceptions\ProviderConnectionException;
use Laravel\Ai\Exceptions\ProviderOverloadedException;
use Laravel\Ai\Prompts\AgentPrompt;

require_once __DIR__.'/AiTestHelpers.php';

/**
 * AiGateway (m3.7 §1): provider and model from config, 8-second timeout, one retry, a call log without content, the daily budget.
 */
beforeEach(function () {
    aiOn(AiFeature::NlSearch);
    $this->member = aiMember();
});

function aiAsk(object $test, string $prompt = 'Suchtext: schwarzer M4 von Lukas aus Hamburg'): mixed
{
    return app(AiGateway::class)->ask(AiFeature::NlSearch, new SearchInterpreterAgent, $prompt, member: $test->member);
}

it('prompts with the configured provider, model and timeout', function () {
    config(['speedclub.ai.model' => 'claude-haiku-5-5', 'speedclub.ai.timeout' => 8]);
    SearchInterpreterAgent::fake([['refused' => false, 'chips' => []]]);

    aiAsk($this);

    SearchInterpreterAgent::assertPrompted(fn (AgentPrompt $prompt): bool => $prompt->model === 'claude-haiku-5-5'
        && $prompt->timeout === 8 && $prompt->provider->name() === 'anthropic');
});

it('logs one row per call with feature, provider, model, latency, tokens and outcome, never the prompt or the answer', function () {
    SearchInterpreterAgent::fake([['refused' => false, 'chips' => [['facet' => 'make', 'value' => 'Geheimmarke']]]]);

    aiAsk($this);
    $call = AiCall::query()->sole();

    expect($call->feature)->toBe(AiFeature::NlSearch)
        ->and($call->outcome)->toBe(AiOutcome::Ok)
        ->and($call->provider)->toBe('anthropic')
        ->and($call->model)->toBe(config('speedclub.ai.model'))
        ->and($call->member_id)->toBe($this->member->id)
        ->and($call->staff_id)->toBeNull()
        ->and($call->latency_ms)->toBeGreaterThanOrEqual(0)
        ->and(array_keys(DB::table('ai_calls')->first() ? (array) DB::table('ai_calls')->first() : []))
        ->toEqualCanonicalizing(['id', 'feature', 'provider', 'model', 'latency_ms', 'input_tokens', 'output_tokens', 'outcome', 'member_id', 'staff_id', 'created_at'])
        ->and(aiCallLog())->not->toContain('Lukas')->not->toContain('Hamburg')->not->toContain('Geheimmarke')->not->toContain('Suchtext');
});

it('retries once on a connection error, an overload or a rate limit', function () {
    $attempts = 0;
    SearchInterpreterAgent::fake(function () use (&$attempts) {
        $attempts++;

        if ($attempts === 1) {
            throw ProviderOverloadedException::forProvider('anthropic');
        }

        return ['refused' => false, 'chips' => []];
    });

    aiAsk($this);

    expect($attempts)->toBe(2)->and(AiCall::query()->sole()->outcome)->toBe(AiOutcome::Ok);
});

it('gives up after the retry: 503 ai_unavailable, logged as a timeout or an error', function () {
    $attempts = 0;
    SearchInterpreterAgent::fake(function () use (&$attempts) {
        $attempts++;

        throw ProviderConnectionException::forProvider('anthropic', 28, new ConnectionException('cURL error 28: Operation timed out after 8000 milliseconds'));
    });

    expect(fn () => aiAsk($this))->toThrow(fn (AiFailed $e) => expect($e->errorCode->value)->toBe('ai_unavailable')->and($e->errorCode->status())->toBe(503));
    expect($attempts)->toBe(2)->and(AiCall::query()->sole()->outcome)->toBe(AiOutcome::Timeout);

    SearchInterpreterAgent::fake(fn () => throw new RuntimeException('boom'));
    expect(fn () => aiAsk($this))->toThrow(AiFailed::class);
    expect(aiLastCall()->outcome)->toBe(AiOutcome::Error);
});

it('logs a refusal and a malformed answer with their outcomes', function () {
    SearchInterpreterAgent::fake([['refused' => true, 'chips' => []], 'not json at all']);

    expect(fn () => aiAsk($this))->toThrow(fn (AiFailed $e) => expect($e->errorCode->value)->toBe('ai_refused'));
    expect(AiCall::query()->where('outcome', 'refused')->count())->toBe(1);

    expect(fn () => aiAsk($this))->toThrow(fn (AiFailed $e) => expect($e->errorCode->value)->toBe('ai_unverifiable'));
    expect(aiLastCall()->outcome)->toBe(AiOutcome::Invalid);
});

it('stops at the daily budget of the feature: 503 ai_budget_exhausted, no call', function () {
    config(['speedclub.ai.daily_calls.nl_search' => 2]);
    AiCall::factory()->count(2)->create(['feature' => AiFeature::NlSearch]);
    AiCall::factory()->create(['feature' => AiFeature::NlSearch, 'created_at' => now()->subDays(2)]);
    SearchInterpreterAgent::fake()->preventStrayPrompts();

    expect(fn () => aiAsk($this))->toThrow(fn (AiFailed $e) => expect($e->errorCode->value)->toBe('ai_budget_exhausted'));
    SearchInterpreterAgent::assertNeverPrompted();
    expect(AiCall::query()->count())->toBe(3);
});

it('prunes call rows after 90 days and expired translations', function () {
    $old = AiCall::factory()->create(['created_at' => now()->subDays(91)]);
    $recent = AiCall::factory()->create(['created_at' => now()->subDays(89)]);
    $expired = AiTranslation::factory()->create(['expires_at' => now()->subMinute()]);
    $live = AiTranslation::factory()->create();
    $orphan = AiTranslation::factory()->create(['source_type' => 'message', 'source_id' => strtolower((string) Str::ulid())]);

    $this->artisan('ai:prune')->assertSuccessful();

    expect(AiCall::query()->whereKey($old->id)->exists())->toBeFalse()
        ->and(AiCall::query()->whereKey($recent->id)->exists())->toBeTrue()
        ->and(AiTranslation::query()->pluck('id')->all())->toBe([$live->id])
        ->and($orphan->id)->not->toBe($live->id)->and($expired->id)->not->toBe($live->id);
});
