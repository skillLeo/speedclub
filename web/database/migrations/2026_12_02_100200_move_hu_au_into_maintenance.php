<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

return new class extends Migration
{
    /**
     * M4.13 (09 §8.8): the HU/AU month of a vehicle (vehicles.hu_au_due, M2.7) becomes its HU/AU maintenance item, so MNT-01, the
     * reminders and "Nächste Fälligkeiten" read one place. vehicles.hu_au_due stays the month (GAR-06 and the vehicle API keep it) and
     * MaintenanceItems keeps both in step from now on. A reminder M2.7 already sent for that month counts as the 30-day stage, so nobody
     * hears about the same HU/AU twice. Idempotent: a vehicle that has its item is skipped.
     */
    public function up(): void
    {
        $now = now();

        DB::table('vehicles')->whereNotNull('hu_au_due')->whereNull('deleted_at')->orderBy('id')
            ->select(['id', 'owner_id', 'hu_au_due', 'hu_au_reminded_for'])
            ->chunk(500, function ($vehicles) use ($now): void {
                $taken = DB::table('maintenance_items')->whereIn('vehicle_id', $vehicles->pluck('id'))->where('slot', 'hu_au')->pluck('vehicle_id')->all();

                foreach ($vehicles as $vehicle) {
                    if (in_array($vehicle->id, $taken, true)) {
                        continue;
                    }

                    $id = strtolower((string) Str::ulid());
                    $due = substr((string) $vehicle->hu_au_due, 0, 10);
                    DB::table('maintenance_items')->insert([
                        'id' => $id,
                        'vehicle_id' => $vehicle->id,
                        'type' => 'hu_au',
                        'slot' => 'hu_au',
                        'interval_months' => 24,
                        'next_due_at' => $due,
                        'due_pinned' => true,
                        'lead_days' => json_encode([30, 14, 1]),
                        'enabled' => true,
                        'version' => 1,
                        'created_at' => $now,
                        'updated_at' => $now,
                    ]);

                    if ($vehicle->hu_au_reminded_for !== null && substr((string) $vehicle->hu_au_reminded_for, 0, 10) === $due) {
                        DB::table('maintenance_reminders')->insertOrIgnore([
                            'item_id' => $id,
                            'user_id' => $vehicle->owner_id,
                            'reminder_key' => 'mnt:'.$id.':d'.$due.':30',
                            'due_on' => $due,
                            'lead_days' => 30,
                            'sent_at' => $now,
                            'created_at' => $now,
                        ]);
                    }
                }
            });
    }

    /**
     * The items made here go again; vehicles.hu_au_due never changed.
     */
    public function down(): void
    {
        DB::table('maintenance_items')->where('type', 'hu_au')->delete();
    }
};
