<?php

namespace App\Actions\Admin\Badges;

use App\Enums\BadgeCategory;
use App\Enums\BadgeTier;
use App\Enums\GiftEvent;
use App\Models\Badge;
use App\Models\Staff;
use App\Services\Admin\Members\StaffAtoms;
use App\Services\Audit\Audit;
use App\Services\Badges\BadgeRules;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Admin badge manager (ADM "Abzeichen", m5.9d contract §2): creates a badge or changes one, atom `content.edit` (owner, admin,
 * content_editor), audited with before and after, no four-eyes. The rule is validated by BadgeRules (whitelisted metrics, no free SQL).
 * A changed rule applies with the next nightly run, or at once through ApplyBadge; badges already earned are never taken back. The key
 * is fixed once created.
 *
 * $input: key (create only, 3–64 of a-z 0-9 -), name_de, name_en, description_de, description_en, hint_de, hint_en, rule_json, hidden,
 * tier, category, sort, active. The admin controller's FormRequest checks the text lengths; this checks the rule, enums and the key.
 */
final class SaveBadge
{
    public function __construct(private readonly BadgeRules $rules) {}

    /**
     * @param  array<string, mixed>  $input
     */
    public function handle(Staff $staff, ?Badge $badge, array $input): Badge
    {
        StaffAtoms::ensure($staff, 'content.edit');

        $values = [
            'name_de' => (string) ($input['name_de'] ?? $badge?->name_de),
            'name_en' => (string) ($input['name_en'] ?? $badge?->name_en),
            'description_de' => (string) ($input['description_de'] ?? $badge?->description_de),
            'description_en' => (string) ($input['description_en'] ?? $badge?->description_en),
            'hint_de' => array_key_exists('hint_de', $input) ? self::nullable($input['hint_de']) : $badge?->hint_de,
            'hint_en' => array_key_exists('hint_en', $input) ? self::nullable($input['hint_en']) : $badge?->hint_en,
            'rule_json' => $this->rules->validate($input['rule_json'] ?? $badge?->rule_json),
            'hidden' => (bool) ($input['hidden'] ?? ($badge === null ? false : $badge->hidden)),
            'tier' => BadgeTier::tryFrom((string) ($input['tier'] ?? $badge?->tier->value)) ?? throw ValidationException::withMessages(['tier' => [(string) __('validation.in', ['attribute' => 'tier'])]]),
            'category' => BadgeCategory::tryFrom((string) ($input['category'] ?? $badge?->category->value)) ?? throw ValidationException::withMessages(['category' => [(string) __('validation.in', ['attribute' => 'category'])]]),
            'sort' => (int) ($input['sort'] ?? ($badge === null ? 0 : $badge->sort)),
            'active' => (bool) ($input['active'] ?? ($badge === null ? true : $badge->active)),
        ];

        if ($values['hidden'] && ($values['hint_de'] === null || $values['hint_en'] === null)) {
            throw ValidationException::withMessages(['hint_de' => [(string) __('validation.required', ['attribute' => 'hint'])]]);
        }

        return DB::transaction(function () use ($staff, $badge, $input, $values): Badge {
            if ($badge === null) {
                $key = (string) ($input['key'] ?? '');

                if (preg_match('/\A[a-z0-9][a-z0-9-]{2,63}\z/', $key) !== 1 || Badge::query()->whereKey($key)->exists()) {
                    throw ValidationException::withMessages(['key' => [(string) __('validation.unique', ['attribute' => 'key'])]]);
                }

                $created = new Badge;
                $created->forceFill(['key' => $key, ...$values])->save();
                Audit::record(GiftEvent::BadgeCreated->value, $created, null, self::snapshot($created), null, $staff);

                return $created;
            }

            $locked = Badge::query()->whereKey($badge->key)->lockForUpdate()->firstOrFail();
            $before = self::snapshot($locked);
            $locked->forceFill($values)->save();
            Audit::record(GiftEvent::BadgeUpdated->value, $locked, $before, self::snapshot($locked), null, $staff);

            return $locked;
        });
    }

    /**
     * @return array<string, mixed>
     */
    public static function snapshot(Badge $badge): array
    {
        return [
            'name_de' => $badge->name_de,
            'name_en' => $badge->name_en,
            'hidden' => $badge->hidden,
            'tier' => $badge->tier->value,
            'category' => $badge->category->value,
            'rule_json' => $badge->rule_json,
            'sort' => $badge->sort,
            'active' => $badge->active,
        ];
    }

    private static function nullable(mixed $value): ?string
    {
        return is_string($value) && trim($value) !== '' ? trim($value) : null;
    }
}
