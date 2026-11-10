<?php

namespace App\Services\Moderation;

use App\Models\SorTemplate;

/**
 * The statement-of-reasons templates of ADM-24 for the decision composer (ADM-21): both languages, in their order. The composer fills
 * the placeholders ({target}, {date}, {member}) from CaseRecord::placeholders() and stays editable; nothing is sent from a template
 * without the staff member's review.
 */
final class SorTemplates
{
    public const PLACEHOLDERS = ['target', 'date', 'member'];

    /**
     * @return list<array{id: string, key: string, locale: string, action: string, label: string, facts: string, ground: string, ground_document: string, ground_section: string|null, sort: int, updated_at: string|null}>
     */
    public static function all(): array
    {
        return array_values(SorTemplate::query()->orderBy('sort')->orderBy('key')->orderBy('locale')->get()->map(fn (SorTemplate $template): array => [
            'id' => $template->id,
            'key' => $template->key,
            'locale' => $template->locale,
            'action' => $template->action->value,
            'label' => $template->label,
            'facts' => $template->facts,
            'ground' => $template->ground,
            'ground_document' => $template->ground_document->value,
            'ground_section' => $template->ground_section,
            'sort' => $template->sort,
            'updated_at' => $template->updated_at?->toIso8601String(),
        ])->all());
    }

    /**
     * @param  array<string, string>  $values
     */
    public static function fill(string $text, array $values): string
    {
        foreach (self::PLACEHOLDERS as $name) {
            $text = str_replace('{'.$name.'}', $values[$name] ?? '', $text);
        }

        return $text;
    }
}
