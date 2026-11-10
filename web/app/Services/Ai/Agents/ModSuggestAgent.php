<?php

namespace App\Services\Ai\Agents;

use Illuminate\Contracts\JsonSchema\JsonSchema;

/**
 * ai.mod_assist: a pasted text (a shop invoice line, a parts description) → a modification category and its fields. The prompt lists the
 * categories with their field schemas; the server keeps only fields of the chosen category that pass its validator, brands of the
 * catalogue, and numbers that stand in the text (ModSuggestion).
 */
final class ModSuggestAgent extends SpeedClubAgent
{
    protected function task(): string
    {
        return <<<'TXT'
        You read a short German or English text about one car modification (for example an invoice line) and fill the fields of the
        modification form of SPEED CLUB. The prompt lists the categories and each category's fields (key, type, unit, options).
        Pick the one category that fits, then return only fields of that category whose value stands in the text:
        numbers exactly as they appear in the text (in the field's unit), option values exactly as listed, brands as written.
        Leave out every field the text does not state. Never estimate, convert into a new number or complete a value.
        TXT;
    }

    protected function fields(JsonSchema $schema): array
    {
        return [
            'category_key' => $schema->string()->max(40)->required(),
            'fields' => $schema->array()->max(20)->items($schema->object(fn (JsonSchema $item): array => [
                'key' => $item->string()->max(60)->required(),
                'value' => $item->string()->max(160)->required(),
            ]))->required(),
        ];
    }
}
