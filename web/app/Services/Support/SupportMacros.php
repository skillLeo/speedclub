<?php

namespace App\Services\Support;

use App\Actions\Support\CreateSupportTicket;
use App\Models\Staff;
use App\Models\SupportMacro;
use App\Models\SupportTicket;
use App\Models\User;

/**
 * The reply macros of ADM-27 for the picker of ADM-26: both languages, in their order, with the variables of a ticket filled in
 * ({name}, {reference}; no staff name, ADR-240 f: replies sign as the team). The reply stays editable before it is sent.
 */
final class SupportMacros
{
    public const VARIABLES = ['name', 'reference'];

    /**
     * @return list<array{id: string, key: string, locale: string, title: string, body: string, sort: int, updated_at: string|null}>
     */
    public static function all(): array
    {
        return array_values(SupportMacro::query()->orderBy('sort')->orderBy('key')->orderBy('locale')->get()->map(fn (SupportMacro $macro): array => [
            'id' => $macro->id,
            'key' => $macro->key,
            'locale' => $macro->locale,
            'title' => $macro->title,
            'body' => $macro->body,
            'sort' => $macro->sort,
            'updated_at' => $macro->updated_at?->toIso8601String(),
        ])->all());
    }

    /**
     * @return array{name: string, reference: string}
     */
    public static function variables(SupportTicket $ticket, Staff $staff): array
    {
        $member = $ticket->user_id === null ? null : User::withTrashed()->find($ticket->user_id);
        $name = $member instanceof User ? ($member->getAttribute('display_name') ?? $member->username ?? '') : ($ticket->getAttribute('name') ?? '');

        return [
            'name' => is_string($name) ? $name : '',
            'reference' => CreateSupportTicket::reference($ticket),
        ];
    }
}
