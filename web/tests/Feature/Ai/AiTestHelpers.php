<?php

use App\Enums\AiFeature;
use App\Models\AiCall;
use App\Models\FeatureFlag;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;

require_once __DIR__.'/../Garage/GarageTestHelpers.php';

/**
 * M3.7 [AI] test helpers, prefixed ai… . No provider key exists (OA-18): every test configures a fake one and uses the SDK's fakes.
 */
function aiProvider(bool $configured = true): void
{
    config(['speedclub.services.ai_provider' => $configured ? 'anthropic' : null, 'ai.providers.anthropic.key' => $configured ? 'test-key-not-real' : null]);
}

function aiOn(AiFeature ...$features): void
{
    aiProvider();

    foreach ($features === [] ? AiFeature::cases() : $features as $feature) {
        FeatureFlag::query()->updateOrCreate(['key' => $feature->flag()], ['enabled' => true, 'rules' => null]);
    }
}

function aiMember(bool $optIn = true, array $attributes = []): User
{
    return User::factory()->create(['ai_suggestions' => $optIn, ...$attributes]);
}

function aiActAs(User $member): User
{
    Sanctum::actingAs($member);

    return $member;
}

/** Every value of every ai_calls row, as one string: for "no content in the log" assertions. */
function aiCallLog(): string
{
    return json_encode(DB::table('ai_calls')->get()->all(), JSON_UNESCAPED_UNICODE) ?: '';
}

function aiLastCall(): AiCall
{
    return AiCall::query()->latest('created_at')->latest('id')->firstOrFail();
}
