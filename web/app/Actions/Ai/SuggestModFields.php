<?php

namespace App\Actions\Ai;

use App\Enums\AiFeature;
use App\Exceptions\ApiException;
use App\Models\User;
use App\Services\Ai\Agents\ModSuggestAgent;
use App\Services\Ai\AiFailed;
use App\Services\Ai\AiGateway;
use App\Services\Ai\ModSuggestion;
use Illuminate\Validation\ValidationException;

/**
 * POST ai/mods/suggest (ai.mod_assist, opt-in; GAR-10 "Aus Text übernehmen"): a pasted text → a category and its fields, limited to the
 * category's field schema and the catalogue's brands, numbers only from the text (ModSuggestion). Nothing is saved. An answer naming a
 * category that was not offered is unverifiable (422 ai_unverifiable, outcome invalid).
 *
 * @throws AiFailed|ApiException|ValidationException
 */
class SuggestModFields
{
    public function __construct(private readonly AiGateway $gateway, private readonly ModSuggestion $suggestion) {}

    /**
     * @return array{category_key: string, fields: array<string, bool|float|int|string>}
     */
    public function handle(User $member, ?string $categoryKey, string $text): array
    {
        $this->gateway->ensureMayUse(AiFeature::ModAssist, $member);
        $text = trim($text);
        $categories = $this->suggestion->categories($categoryKey);

        if ($categories->isEmpty()) {
            throw ValidationException::withMessages(['category_key' => [(string) __('ai.unknown_category')]]);
        }

        $answer = $this->gateway->ask(AiFeature::ModAssist, new ModSuggestAgent, $this->suggestion->prompt($categories, $text), member: $member);

        return $this->suggestion->resolve($answer, $categories, $text) ?? $this->gateway->reject($answer);
    }
}
