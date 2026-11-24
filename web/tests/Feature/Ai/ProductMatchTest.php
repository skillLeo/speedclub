<?php

use App\Enums\AiFeature;
use App\Models\AiTextNormalisation;
use App\Models\Brand;
use App\Models\FeatureFlag;
use App\Models\ModCategory;
use App\Models\Product;
use App\Models\User;
use App\Services\Ai\Agents\ProductNormaliseAgent;
use Illuminate\Testing\TestResponse;
use Laravel\Ai\Prompts\AgentPrompt;
use Laravel\Sanctum\Sanctum;

require_once __DIR__.'/AiTestHelpers.php';

/**
 * M5.9 mod editor (10 §8.2, m5.9-contract §2.2, lead D-2): catalogue first (every word must match, no AI), the AI only to normalise a
 * typed part into catalogue words, and the answer is catalogue products only.
 */
beforeEach(function () {
    aiOn(AiFeature::ProductMatch);
    FeatureFlag::query()->updateOrCreate(['key' => 'parts_catalogue'], ['enabled' => true, 'description' => 'parts']);
    $this->suspension = ModCategory::factory()->create(['key' => 'suspension']);
    $this->kw = Brand::factory()->create(['name' => 'KW']);
    $this->v3 = Product::factory()->create(['brand_id' => $this->kw->id, 'category_id' => $this->suspension->id, 'name' => 'Variant 3 Gewindefahrwerk']);
    Product::factory()->create(['brand_id' => $this->kw->id, 'category_id' => $this->suspension->id, 'name' => 'Variant 1 Gewindefahrwerk']);
});

function matchAsk(User $member, array $body): TestResponse
{
    aiActAs($member);

    return test()->postJson('/api/v1/ai/products/match', $body, ['Accept-Language' => 'de']);
}

it('finds the product by its words without the AI, also through the plain product search', function () {
    ProductNormaliseAgent::fake()->preventStrayPrompts();

    $data = matchAsk(aiMember(), ['text' => 'kw variant 3', 'category_key' => 'suspension'])->assertOk()->json('data');

    expect($data['label'])->toBeNull()
        ->and($data['normalized'])->toBeNull()
        ->and(array_column($data['products'], 'id'))->toBe([$this->v3->id]);

    $this->getJson('/api/v1/products?q=kw%20variant%203&per_page=8')->assertOk()->assertJsonPath('data.0.id', $this->v3->id)->assertJsonCount(1, 'data');
    ProductNormaliseAgent::assertNeverPrompted();
});

it('lets the AI normalise "kw v3" when the catalogue finds nothing, answering catalogue products only', function () {
    ProductNormaliseAgent::fake([['refused' => false, 'brand' => 'KW', 'terms' => ['Variant', '3']]]);
    $member = aiMember(attributes: ['username' => 'tuner.max']);

    $data = matchAsk($member, ['text' => 'kw v3', 'category_key' => 'suspension'])->assertOk()->json('data');

    expect($data['label'])->toBe('KI-Vorschlag')
        ->and($data['normalized'])->toBe('KW Variant 3')
        ->and(array_column($data['products'], 'id'))->toBe([$this->v3->id]);
    ProductNormaliseAgent::assertPrompted(fn (AgentPrompt $prompt): bool => $prompt->contains('kw v3') && $prompt->contains('suspension') && ! $prompt->contains('tuner.max'));
});

it('never answers a product the catalogue does not list', function () {
    ProductNormaliseAgent::fake([['refused' => false, 'brand' => 'Ohlins', 'terms' => ['Road', 'Track']]]);

    matchAsk(aiMember(), ['text' => 'öhlins rt'])->assertOk()->assertJsonPath('data.products', [])->assertJsonPath('data.normalized', 'Ohlins Road Track');
});

it('caches the normalisation per text and category, without the member', function () {
    ProductNormaliseAgent::fake([['refused' => false, 'brand' => 'KW', 'terms' => ['Variant', '3']]]);
    $first = aiMember();
    matchAsk($first, ['text' => 'kw v3', 'category_key' => 'suspension'])->assertOk();
    matchAsk(aiMember(), ['text' => '  KW   v3 ', 'category_key' => 'suspension'])->assertOk()->assertJsonPath('data.normalized', 'KW Variant 3');

    ProductNormaliseAgent::assertPromptedTimes(1);
    expect(json_encode(AiTextNormalisation::query()->sole()->toArray()))->not->toContain($first->id);
});

it('validates the text and needs the parts catalogue', function () {
    ProductNormaliseAgent::fake()->preventStrayPrompts();
    $member = aiMember();

    matchAsk($member, ['text' => ''])->assertUnprocessable()->assertJsonValidationErrors('text');
    matchAsk($member, ['text' => str_repeat('a', 81)])->assertUnprocessable()->assertJsonValidationErrors('text');

    FeatureFlag::query()->where('key', 'parts_catalogue')->update(['enabled' => false]);
    matchAsk($member, ['text' => 'kw v3'])->assertNotFound()->assertJsonPath('code', 'feature_disabled');
});

it('needs a member with the opt-in and a verified address, the flag and a key', function (Closure $setup, int $status, string $code) {
    ProductNormaliseAgent::fake()->preventStrayPrompts();
    $member = $setup();

    if ($member instanceof User) {
        Sanctum::actingAs($member);
    }

    $this->postJson('/api/v1/ai/products/match', ['text' => 'kw v3'])->assertStatus($status)->assertJsonPath('code', $code);
})->with([
    'guest' => [fn (): ?User => null, 401, 'unauthenticated'],
    'opt-in off' => [fn (): User => aiMember(false), 403, 'ai_opt_in_required'],
    'unverified' => [fn (): User => aiMember(attributes: ['email_verified_at' => null]), 403, 'email_not_verified'],
    'flag off' => [function (): User {
        FeatureFlag::query()->where('key', 'ai.product_match')->update(['enabled' => false]);

        return aiMember();
    }, 404, 'feature_disabled'],
    'no key' => [function (): User {
        aiProvider(false);

        return aiMember();
    }, 404, 'feature_disabled'],
]);

it('answers 503 when the provider fails and 429 over the member\'s share', function () {
    config(['speedclub.ai.member_daily_min' => 1, 'speedclub.ai.member_daily_share' => 0.0]);
    $member = aiMember();
    ProductNormaliseAgent::fake([['refused' => false, 'brand' => 'BC Racing', 'terms' => ['BR']]]);
    matchAsk($member, ['text' => 'bc br'])->assertOk();

    matchAsk($member, ['text' => 'hr federn'])->assertStatus(429)->assertJsonPath('code', 'ai_daily_limit');

    ProductNormaliseAgent::fake(fn () => throw new RuntimeException('down'));
    matchAsk(aiMember(), ['text' => 'eibach pro'])->assertStatus(503)->assertJsonPath('code', 'ai_unavailable');
});
