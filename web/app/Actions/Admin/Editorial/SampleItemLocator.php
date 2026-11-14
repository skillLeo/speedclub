<?php

namespace App\Actions\Admin\Editorial;

use App\Enums\SampleItemType;
use App\Models\Business;
use App\Models\Event;
use App\Models\Vehicle;
use App\Services\Showcase\SampleContent;
use DomainException;
use Illuminate\Support\Facades\DB;
use stdClass;

/**
 * Finds a sample item of ADM-58 under its row lock and reads its open hide record. Only samples (SampleContent::isSample: its own flag
 * or its owner's) can be hidden or shown here; a real member's build, meet or business never.
 */
final class SampleItemLocator
{
    /**
     * @throws DomainException when the item is missing or no sample
     */
    public static function lock(SampleItemType $type, string $id): Vehicle|Event|Business
    {
        $id = strtolower($id);
        $item = match ($type) {
            SampleItemType::Vehicle => Vehicle::query()->with('owner')->whereKey($id)->lockForUpdate()->first(),
            SampleItemType::Event => Event::query()->with('organiser')->whereKey($id)->lockForUpdate()->first(),
            SampleItemType::Business => Business::query()->with('owner')->whereKey($id)->lockForUpdate()->first(),
        };

        if ($item === null || ! SampleContent::isSample($item)) {
            throw new DomainException('not_sample');
        }

        return $item;
    }

    /**
     * The open hide record of the item (restored_at null), or null.
     */
    public static function openRecord(SampleItemType $type, string $id): ?stdClass
    {
        return DB::table('sample_hidden_items')
            ->where(['subject_type' => $type->value, 'subject_id' => strtolower($id)])
            ->whereNull('restored_at')
            ->lockForUpdate()
            ->first();
    }
}
