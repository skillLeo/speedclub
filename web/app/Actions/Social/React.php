<?php

namespace App\Actions\Social;

use App\Enums\ReactionType;
use App\Models\BuildUpdate;
use App\Models\Reaction;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\Notifications\Notifier;
use Illuminate\Support\Facades\DB;
use Throwable;

/**
 * Sets the member's one reaction on a build or build update (09 §8.5), or changes it. Idempotent by the unique (member, item). Only a
 * first reaction tells the owner (reaction rows, batched per day, one push an hour); changing it is no news.
 */
class React
{
    public function __construct(private readonly Notifier $notifier) {}

    public function handle(User $user, Vehicle|BuildUpdate $target, ReactionType $type): Reaction
    {
        [$reaction, $new] = DB::transaction(function () use ($user, $target, $type): array {
            $inserted = Reaction::query()->insertOrIgnore([
                'user_id' => $user->id,
                'reactable_type' => $target->getMorphClass(),
                'reactable_id' => (string) $target->getKey(),
                'type' => $type->value,
                'created_at' => now(),
                'updated_at' => now(),
            ]) === 1;

            $reaction = Reaction::query()->where('user_id', $user->id)->where('reactable_type', $target->getMorphClass())
                ->where('reactable_id', (string) $target->getKey())->lockForUpdate()->firstOrFail();

            if (! $inserted && $reaction->type !== $type) {
                $reaction->forceFill(['type' => $type])->save();
            }

            return [$reaction, $inserted];
        });

        if ($new) {
            $vehicle = $target instanceof Vehicle ? $target : $target->vehicle;
            $owner = $vehicle->owner;

            try {
                if ($owner instanceof User) {
                    $this->notifier->reaction($owner, $user, $vehicle, $target instanceof BuildUpdate ? $target : null);
                }
            } catch (Throwable $exception) {
                report($exception);
            }
        }

        return $reaction;
    }
}
