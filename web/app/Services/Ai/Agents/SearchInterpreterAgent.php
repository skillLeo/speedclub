<?php

namespace App\Services\Ai\Agents;

use App\Services\Ai\SearchChips;
use Illuminate\Contracts\JsonSchema\JsonSchema;

/**
 * ai.nl_search: a free-text vehicle search ("schwarze M4 mit KW V3 und 19 Zoll") → Discover filter chips. Only the facets of
 * SearchChips::FACETS; the server resolves every value against the catalogue and drops what it does not know.
 */
final class SearchInterpreterAgent extends SpeedClubAgent
{
    protected function task(): string
    {
        return <<<'TXT'
        You turn a German or English search for modified cars on SPEED CLUB into search filters. Return one chip per filter the text names.
        Facets:
        - make: the car make as written ("BMW"); model: the model ("M4"); generation: a generation code ("G82").
        - year_min, year_max: model years; power_min, power_max: power in PS; wheel_diameter: wheel size in inches. Only numbers that
          appear in the text.
        - wheel_brand, suspension_brand, exhaust_brand: a parts brand as written ("BBS", "KW").
        - drivetrain, gearbox, fuel, suspension_type, mod_category: only the values the prompt lists for them.
        Use only these facets. Leave out what the text does not say (a colour, a city, a member); never guess.
        TXT;
    }

    protected function fields(JsonSchema $schema): array
    {
        return [
            'chips' => $schema->array()->max(12)->items($schema->object(fn (JsonSchema $item): array => [
                'facet' => $item->string()->enum(SearchChips::FACETS)->required(),
                'value' => $item->string()->max(60)->required(),
            ]))->required(),
        ];
    }
}
