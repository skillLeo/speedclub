<?php

namespace App\Actions\Admin\Editorial;

use App\Actions\Garage\ChangeVehicleVisibility;
use App\Enums\SampleItemType;
use App\Enums\Visibility;
use App\Models\Business;
use App\Models\Event;
use App\Models\Staff;
use App\Models\Vehicle;
use App\Services\Admin\Members\StaffAtoms;
use App\Services\Audit\Audit;
use App\Services\Catalog\Reason;
use Carbon\CarbonImmutable;
use DomainException;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * ADM-58 "Wieder zeigen" (`content.edit`, recent password, reason): restores what HideSampleItem changed, only while the item is still in
 * the state the hide left (a build still private, a meet or business still removed at the moment it was hidden). An item a moderation
 * decision or its owner changed since is not touched: the record closes and the answer says so (false). Audited
 * `editorial.sample_shown`.
 *
 * @throws AuthorizationException|DomainException|ValidationException
 */
final class ShowSampleItem
{
    public function __construct(private readonly ChangeVehicleVisibility $visibility) {}

    /**
     * @return bool whether the item was restored (false: it changed since the hide; the record is closed anyway)
     */
    public function handle(Staff $staff, SampleItemType $type, string $id, string $reason): bool
    {
        StaffAtoms::ensure($staff, 'content.edit');
        $reason = Reason::required($reason);

        return DB::transaction(function () use ($staff, $type, $id, $reason): bool {
            $item = SampleItemLocator::lock($type, $id);
            $record = SampleItemLocator::openRecord($type, $item->getKey());

            if ($record === null) {
                throw new DomainException('not_hidden');
            }

            /** @var array<string, mixed> $previous */
            $previous = json_decode((string) $record->previous, true) ?: [];
            $hiddenAt = CarbonImmutable::parse((string) $record->hidden_at, 'UTC');
            $unchanged = match (true) {
                $item instanceof Vehicle => ! $item->trashed() && $item->visibility === Visibility::Private,
                $item instanceof Event, $item instanceof Business => self::removedByHide($item, $hiddenAt),
            };

            DB::table('sample_hidden_items')->where('id', $record->id)->update(['restored_by' => $staff->id, 'restored_at' => now()]);

            if (! $unchanged) {
                Audit::record('editorial.sample_shown', $item, ['hidden' => true], ['restored' => false, 'record' => $record->id], $reason, $staff);

                return false;
            }

            match (true) {
                $item instanceof Vehicle => $this->visibility->handle($item, Visibility::tryFrom((string) ($previous['visibility'] ?? '')) ?? Visibility::Public),
                $item instanceof Event, $item instanceof Business => $item->forceFill(['removed_at' => null])->save(),
            };

            Audit::record('editorial.sample_shown', $item, ['hidden' => true], ['restored' => true, ...$previous, 'record' => $record->id], $reason, $staff);

            return true;
        });
    }

    private static function removedByHide(Event|Business $item, CarbonImmutable $hiddenAt): bool
    {
        $removed = $item->getAttribute('removed_at');

        return $removed instanceof CarbonImmutable && abs($removed->getTimestamp() - $hiddenAt->getTimestamp()) <= 2;
    }
}
