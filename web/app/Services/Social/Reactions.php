<?php

namespace App\Services\Social;

use App\Enums\ReactionType;
use App\Models\Reaction;
use App\Models\User;
use App\Services\AppConfig\FeatureFlags;
use Illuminate\Database\Eloquent\Model;

/**
 * Reads of private reactions (09 §8.5, ADR-413): the viewer's own reaction for anybody, the summary for the owner only. Callers decide
 * who is the owner; nothing here ever hands a count to a resource on its own.
 */
final class Reactions
{
    public const FLAG = 'build_reactions';

    public function __construct(private readonly FeatureFlags $flags) {}

    public function enabled(): bool
    {
        return $this->flags->enabled(self::FLAG);
    }

    public function mine(?User $viewer, Model $target): ?ReactionType
    {
        if ($viewer === null || ! $this->enabled()) {
            return null;
        }

        $type = Reaction::query()->where('user_id', $viewer->id)->where('reactable_type', $target->getMorphClass())
            ->where('reactable_id', (string) $target->getKey())->value('type');

        return $type instanceof ReactionType ? $type : ReactionType::tryFrom((string) $type);
    }

    /**
     * Counts per kind and in total, for the owner's eyes only. Reactions of members the owner may no longer see still count: the owner
     * reads their own feedback, and the list (ReactionController) leaves those members out.
     *
     * @return array{strong: int, clean: int, low: int, loud: int, total: int}
     */
    public function summary(Model $target): array
    {
        $counts = Reaction::query()->where('reactable_type', $target->getMorphClass())->where('reactable_id', (string) $target->getKey())
            ->selectRaw('type, COUNT(*) as aggregate')->groupBy('type')->pluck('aggregate', 'type');

        $summary = ['strong' => 0, 'clean' => 0, 'low' => 0, 'loud' => 0, 'total' => 0];

        foreach (ReactionType::cases() as $type) {
            $summary[$type->value] = (int) ($counts[$type->value] ?? 0);
            $summary['total'] += $summary[$type->value];
        }

        return $summary;
    }
}
