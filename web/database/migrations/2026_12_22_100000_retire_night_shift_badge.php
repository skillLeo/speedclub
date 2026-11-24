<?php

use App\Actions\Admin\Badges\RevokeBadge;
use App\Enums\GiftEvent;
use App\Models\Badge;
use App\Models\User;
use App\Models\UserBadge;
use App\Services\Audit\Audit;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * ADR-516 b (gift gate design QA DQ-P5G-07): no badge rewards the hour of a spot. The hidden badge `nachtschicht` (10 spots 22–06 Uhr)
 * left BadgeSeeder and its metric `night_spots` left the rule DSL; on hosts that already seeded it, this deactivates the row (matched by
 * key: a badge staff renamed keeps its key) and takes it back from every member who earned it (RevokeBadge::take: the earned row and the
 * still unread unlock notification go, no push). Audited by the system: `badge.deactivated` once, `badge.revoked` per member. The row
 * stays (inactive, its rule no longer validates, so it is awarded to nobody, and SetBadgeActive refuses to switch it back on until staff build a new rule).
 * Running it again finds an inactive badge and no awards and writes nothing; a fresh install never seeds the badge.
 */
return new class extends Migration
{
    public const KEY = 'nachtschicht';

    public const REASON = 'Abzeichen entfernt: Kein Abzeichen belohnt die Uhrzeit eines Spots (ADR-516 b).';

    public function up(): void
    {
        $this->retire();
    }

    /**
     * @return array{deactivated: bool, revoked: int}
     */
    public function retire(): array
    {
        $deactivated = DB::transaction(function (): bool {
            $badge = Badge::query()->whereKey(self::KEY)->lockForUpdate()->first();

            if (! $badge instanceof Badge || ! $badge->active) {
                return false;
            }

            $badge->forceFill(['active' => false])->save();
            Audit::record(GiftEvent::BadgeDeactivated->value, $badge, ['active' => true], ['active' => false], self::REASON);

            return true;
        });

        $revoked = 0;

        UserBadge::query()->where('badge_key', self::KEY)->orderBy('user_id')->pluck('user_id')->each(function (string $userId) use (&$revoked): void {
            $member = User::withTrashed()->find($userId);

            if ($member instanceof User && RevokeBadge::take($member, self::KEY, self::REASON, null)) {
                $revoked++;
            }
        });

        return ['deactivated' => $deactivated, 'revoked' => $revoked];
    }

    public function down(): void
    {
        // Taking a badge back cannot be undone: the awards are gone and the rule no longer exists.
    }
};
