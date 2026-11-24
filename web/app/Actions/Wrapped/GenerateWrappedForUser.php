<?php

namespace App\Actions\Wrapped;

use App\Models\Staff;
use App\Models\User;
use App\Models\Wrapped;
use App\Services\Audit\Audit;
use App\Services\Wrapped\Season;
use App\Services\Wrapped\WrappedGenerator;

/**
 * ADM "Vorschau erzeugen" (m5.9e contract §2, admin user record → Wrapped tab, built by the admin batch): generates one member's
 * Wrapped of a season now, exactly as the nightly run would, and audits it (`wrapped.preview_generated`, the staff member as actor,
 * the member as target; only the season and the card kinds, never the payload). Returns the row, or null when the member had nothing
 * in the season (or is a sample in production). The admin controller checks the staff atom (e.g. `members.view`) before calling.
 */
final class GenerateWrappedForUser
{
    public const AUDIT_EVENT = 'wrapped.preview_generated';

    public function __construct(private readonly WrappedGenerator $generator) {}

    public function __invoke(Staff $staff, User $member, string $seasonKey): ?Wrapped
    {
        $season = Season::from($seasonKey);
        $wrapped = $this->generator->generate($member, $season);

        Audit::record(self::AUDIT_EVENT, $member, null, [
            'season_key' => $season->key,
            'generated' => $wrapped !== null,
            'cards' => $wrapped === null ? [] : array_map(fn (array $card): string => (string) ($card['kind'] ?? ''), $wrapped->cards()),
        ], actor: $staff);

        return $wrapped;
    }
}
