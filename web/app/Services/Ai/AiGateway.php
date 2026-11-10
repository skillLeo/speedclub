<?php

namespace App\Services\Ai;

use App\Enums\AiFeature;
use App\Enums\AiOutcome;
use App\Enums\ErrorCode;
use App\Exceptions\ApiException;
use App\Models\AiCall;
use App\Models\Staff;
use App\Models\User;
use App\Services\AppConfig\FeatureFlags;
use App\Services\System\Integrations;
use App\Services\System\SystemTestAgent;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;
use Laravel\Ai\Contracts\Agent;
use Laravel\Ai\Contracts\HasStructuredOutput;
use Laravel\Ai\Exceptions\FailoverableException;
use Laravel\Ai\Responses\AgentResponse;
use Laravel\Ai\Responses\StructuredAgentResponse;
use Throwable;

/**
 * The one way to an AI provider (02_PRODUCT_SPEC §6, ADR-030, m3.7 contract §1), on the Laravel AI SDK (laravel/ai): an agent class per
 * feature (App\Services\Ai\Agents) with its instructions and a JSON schema for structured output, prompted with the provider of
 * speedclub.services.ai_provider and the model of speedclub.ai.model (default Anthropic claude-haiku-5-5), an 8-second timeout and one
 * retry on the SDK's failover exceptions (connection, overload, rate limit). Tests and dev use the SDK's fake (Agent::fake()).
 *
 * Every call is one ai_calls row: feature, provider, model, latency, tokens, outcome, the member or staff member. Never the prompt, the
 * answer or anything from them; failures are logged by class name only.
 *
 * Without a provider and its key available() is false: no ai.* flag can be switched on (UpdateFeatureFlag) and every endpoint answers 404
 * feature_disabled (ensureEnabled()), whatever the flag table says.
 */
final class AiGateway
{
    public function __construct(private readonly FeatureFlags $flags) {}

    public function available(): bool
    {
        return Integrations::aiConfigured();
    }

    public function provider(): string
    {
        $provider = config('speedclub.services.ai_provider');

        return is_string($provider) && $provider !== '' ? $provider : 'anthropic';
    }

    public function model(): string
    {
        return config()->string('speedclub.ai.model');
    }

    /** Provider configured and the feature's flag on (the app-config rule: on, not staff-only, a full rollout). */
    public function enabled(AiFeature $feature): bool
    {
        return $this->available() && $this->flags->enabled($feature->flag());
    }

    /**
     * 404 feature_disabled unless enabled(); 403 ai_opt_in_required for a feature that needs the member's opt-in (SET privacy
     * "KI-Vorschläge", users.ai_suggestions) when it is off.
     *
     * @throws ApiException
     */
    public function ensureMayUse(AiFeature $feature, User $member): void
    {
        if (! $this->enabled($feature)) {
            throw new ApiException(ErrorCode::FeatureDisabled);
        }

        if ($feature->needsOptIn() && $member->getAttribute('ai_suggestions') !== true) {
            throw new ApiException(ErrorCode::AiOptInRequired);
        }

        // SEC-P3-19: a throwaway account (registration takes 5 an hour per address) never spends the shared budget.
        if (! $member->hasVerifiedEmail()) {
            throw new ApiException(ErrorCode::EmailNotVerified);
        }
    }

    /**
     * Prompts $agent once (plus one retry) and returns its structured answer. Refused (the schema's `refused` true) and malformed answers
     * are logged and thrown; what the answer means is the feature's post-check (and AiGateway::reject() when it fails).
     *
     * @param  list<mixed>  $attachments  SDK files (Laravel\Ai\Files\Image …)
     *
     * @throws AiFailed
     */
    public function ask(AiFeature $feature, Agent&HasStructuredOutput $agent, string $prompt, array $attachments = [], ?User $member = null, ?Staff $staff = null): AiAnswer
    {
        if ($this->usedToday($feature) >= $this->dailyBudget($feature)) {
            throw AiFailed::budget();
        }

        if ($member !== null && $this->usedTodayBy($feature, $member) >= $this->memberBudget($feature)) {
            throw AiFailed::memberLimit();
        }

        $started = hrtime(true);
        $attempts = 1 + max(0, config()->integer('speedclub.ai.retries'));
        $response = null;
        $failure = null;

        for ($attempt = 1; $attempt <= $attempts; $attempt++) {
            try {
                $response = $agent->prompt($prompt, $attachments, provider: $this->provider(), model: $this->model(), timeout: config()->integer('speedclub.ai.timeout'));
                $failure = null;

                break;
            } catch (FailoverableException $retryable) {
                $failure = $retryable;
            } catch (Throwable $other) {
                $failure = $other;

                break;
            }
        }

        $latency = self::since($started);

        if ($failure !== null || ! $response instanceof AgentResponse) {
            $outcome = $failure !== null && self::timedOut($failure) ? AiOutcome::Timeout : AiOutcome::Error;
            $this->log($feature, $outcome, $latency, null, $member, $staff);
            Log::warning('An AI call failed.', ['feature' => $feature->value, 'type' => $failure === null ? 'no_response' : $failure::class]);

            throw AiFailed::unavailable($outcome);
        }

        $data = $response instanceof StructuredAgentResponse ? $response->toArray() : null;

        // Every schema carries `refused` (SpeedClubAgent): without it the answer did not follow the schema.
        if (! is_array($data) || ! is_bool($data['refused'] ?? null)) {
            $this->log($feature, AiOutcome::Invalid, $latency, $response, $member, $staff);

            throw AiFailed::unverifiable();
        }

        if ($data['refused'] === true) {
            $this->log($feature, AiOutcome::Refused, $latency, $response, $member, $staff);

            throw AiFailed::refused();
        }

        $call = $this->log($feature, AiOutcome::Ok, $latency, $response, $member, $staff);

        return new AiAnswer($call->id, $data);
    }

    /**
     * ADM-50 "KI testen" and the AiProvider health check's deep test: one short prompt without any member data (SystemTestAgent) with the
     * provider, model and timeout of every feature, logged as `connectivity_test` with the staff member. Never throws.
     *
     * @return array{ok: bool, error: string|null, answer: string|null}
     */
    public function probe(?Staff $staff = null): array
    {
        $started = hrtime(true);

        try {
            $response = (new SystemTestAgent)->prompt('Connectivity check: answer OK.', provider: $this->provider(), model: $this->model(), timeout: config()->integer('speedclub.ai.timeout'));
        } catch (Throwable $failure) {
            $this->log(AiFeature::ConnectivityTest, self::timedOut($failure) ? AiOutcome::Timeout : AiOutcome::Error, self::since($started), null, null, $staff);

            return ['ok' => false, 'error' => class_basename($failure), 'answer' => null];
        }

        $this->log(AiFeature::ConnectivityTest, AiOutcome::Ok, self::since($started), $response, null, $staff);

        return ['ok' => true, 'error' => null, 'answer' => Str::limit(trim((string) $response), 120, '')];
    }

    /**
     * A feature's post-check rejected the answer: the call's outcome becomes $outcome (invalid or refused) and the request fails.
     *
     * @throws AiFailed
     */
    public function reject(AiAnswer $answer, AiOutcome $outcome = AiOutcome::Invalid): never
    {
        $this->markInvalid($answer, $outcome);

        throw $outcome === AiOutcome::Refused ? AiFailed::refused() : AiFailed::unverifiable();
    }

    /** Records that a post-check rejected the answer, without failing (the triage jobs simply store nothing). */
    public function markInvalid(AiAnswer $answer, AiOutcome $outcome = AiOutcome::Invalid): void
    {
        AiCall::query()->whereKey($answer->callId)->update(['outcome' => $outcome->value]);
    }

    public function dailyBudget(AiFeature $feature): int
    {
        return config()->integer('speedclub.ai.daily_calls.'.$feature->value, 0);
    }

    /**
     * SEC-P3-19: what one member may spend of a feature a day: speedclub.ai.member_daily_share of its budget, at least
     * member_daily_min, never more than the budget itself.
     */
    public function memberBudget(AiFeature $feature): int
    {
        $budget = $this->dailyBudget($feature);
        $share = (int) floor($budget * (float) config('speedclub.ai.member_daily_share', 0.02));

        return min($budget, max(config()->integer('speedclub.ai.member_daily_min', 20), $share));
    }

    /** The member's calls of the feature since midnight in Europe/Berlin. */
    public function usedTodayBy(AiFeature $feature, User $member): int
    {
        $midnight = Carbon::now(config()->string('speedclub.display_timezone'))->startOfDay()->utc();

        return AiCall::query()->where('member_id', $member->getKey())->where('feature', $feature->value)->where('created_at', '>=', $midnight)->count();
    }

    /** Calls of the feature since midnight in Europe/Berlin. */
    public function usedToday(AiFeature $feature): int
    {
        $midnight = Carbon::now(config()->string('speedclub.display_timezone'))->startOfDay()->utc();

        return AiCall::query()->where('feature', $feature->value)->where('created_at', '>=', $midnight)->count();
    }

    private function log(AiFeature $feature, AiOutcome $outcome, int $latency, ?AgentResponse $response, ?User $member, ?Staff $staff): AiCall
    {
        $call = new AiCall;
        $call->forceFill([
            'feature' => $feature,
            'provider' => mb_substr($response?->meta->provider ?? $this->provider(), 0, 40),
            'model' => mb_substr($response?->meta->model ?? $this->model(), 0, 80),
            'latency_ms' => max(0, $latency),
            'input_tokens' => max(0, $response->usage->inputTokens ?? 0),
            'output_tokens' => max(0, $response->usage->outputTokens ?? 0),
            'outcome' => $outcome,
            'member_id' => $member?->getKey(),
            'staff_id' => $staff?->getKey(),
        ])->save();

        return $call;
    }

    private static function since(int|float $started): int
    {
        return (int) round((hrtime(true) - $started) / 1_000_000);
    }

    private static function timedOut(Throwable $failure): bool
    {
        for ($cause = $failure; $cause !== null; $cause = $cause->getPrevious()) {
            $message = strtolower($cause->getMessage());

            if (str_contains($message, 'timed out') || str_contains($message, 'curl error 28') || str_contains($message, 'timeout')) {
                return true;
            }
        }

        return false;
    }
}
