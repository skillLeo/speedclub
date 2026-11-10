<?php

namespace App\Actions\Ai;

use App\Enums\AiFeature;
use App\Models\User;
use App\Services\Ai\Agents\SearchInterpreterAgent;
use App\Services\Ai\AiFailed;
use App\Services\Ai\AiGateway;
use App\Services\Ai\SearchChips;

/**
 * POST ai/search/interpret (ai.nl_search, opt-in): a free-text search → Discover filter chips, labelled "KI-Vorschlag" in the app and
 * applied as normal, editable chips. Unknown values are dropped (SearchChips); an empty list is a valid answer.
 *
 * @throws AiFailed
 */
class InterpretSearch
{
    public function __construct(private readonly AiGateway $gateway, private readonly SearchChips $chips) {}

    /**
     * @return list<array{facet: string, value: string, label: string}>
     */
    public function handle(User $member, string $query): array
    {
        $this->gateway->ensureMayUse(AiFeature::NlSearch, $member);
        $query = trim($query);

        $answer = $this->gateway->ask(AiFeature::NlSearch, new SearchInterpreterAgent, $this->chips->prompt($query), member: $member);

        return $this->chips->resolve($answer->list('chips'), $query);
    }
}
