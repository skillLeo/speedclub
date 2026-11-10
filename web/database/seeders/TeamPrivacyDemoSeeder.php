<?php

namespace Database\Seeders;

use App\Enums\PrivacyRequestSource;
use App\Enums\PrivacyRequestStatus;
use App\Enums\PrivacyRequestType;
use App\Models\PrivacyRequest;
use App\Models\Role;
use App\Models\Staff;
use App\Models\User;
use Carbon\CarbonImmutable;
use Database\Seeders\Concerns\SeedClock;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;
use Spatie\Permission\PermissionRegistrar;

/**
 * M3.6 demo (ADM-41, ADM-45/46, ADM-49), local and staging only, called by DemoSeeder at the end: GDPR requests in every state with fixed
 * ids and dates before NOW (one due in five days, one overdue, one waiting with its extension, one completed with evidence, one from an
 * external person), a custom role with a description, and one failed job (class name only). Idempotent: rows with these ids are replaced.
 */
class TeamPrivacyDemoSeeder extends Seeder
{
    /** ADM-46 in the visual registry (routes-m36.mjs). */
    public const ACCESS_REQUEST = '01m6c0r3q0a5k0000000000001';

    public const FAILED_JOB = '6f1d2c3b-4a5e-4f60-8b7a-9c0d1e2f3a4b';

    public function run(CarbonImmutable $now): void
    {
        $lukas = User::query()->where('username', 'lukas.sc')->first();
        $tobi = User::query()->where('username', 'tobi.quattro')->first();
        $support = Staff::query()->where('email', 'support@speedclub.test')->first();
        $admin = Staff::query()->where('email', 'admin@speedclub.test')->first();
        $at = fn (string $date): CarbonImmutable => CarbonImmutable::parse($date, 'Europe/Berlin')->utc();

        $rows = [
            [
                'id' => self::ACCESS_REQUEST, 'type' => PrivacyRequestType::Access, 'status' => PrivacyRequestStatus::InProgress, 'source' => PrivacyRequestSource::Email,
                'user_id' => $lukas?->id, 'requester_name' => 'Lukas Schneider', 'requester_email' => null, 'locale' => 'de',
                'details' => "Hallo SPEED CLUB,\nbitte schickt mir eine Kopie aller Daten, die ihr über mich gespeichert habt, auch die Fotos meiner Fahrzeuge und meine Nachrichten.\nDanke, Lukas",
                'received_at' => $at('2026-10-04 09:12'), 'due_at' => $at('2026-11-04 09:12'), 'assigned_to' => $admin?->id,
            ],
            [
                'id' => '01m6c0r3q0a5k0000000000002', 'type' => PrivacyRequestType::Objection, 'status' => PrivacyRequestStatus::Open, 'source' => PrivacyRequestSource::Post,
                'user_id' => null, 'requester_name' => 'Thomas Berger', 'requester_email' => 'thomas.berger@beispiel.de', 'locale' => 'de',
                'details' => 'Ich widerspreche der Nutzung meiner E-Mail-Adresse für Hinweise zu neuen Funktionen.',
                'received_at' => $at('2026-09-20 14:30'), 'due_at' => $at('2026-10-20 14:30'), 'assigned_to' => null,
            ],
            [
                'id' => '01m6c0r3q0a5k0000000000003', 'type' => PrivacyRequestType::Rectification, 'status' => PrivacyRequestStatus::Waiting, 'source' => PrivacyRequestSource::Support,
                'user_id' => $tobi?->id, 'requester_name' => null, 'requester_email' => null, 'locale' => 'de',
                'details' => 'Das Baujahr in meinem alten Profil ist falsch und lässt sich in der App nicht mehr ändern.',
                'received_at' => $at('2026-10-10 18:05'), 'due_at' => $at('2027-01-10 18:05'), 'extended_at' => $at('2026-10-21 10:00'),
                'extension_reason' => 'Wir warten auf den Nachweis zur Fahrzeug-Identnummer vom Mitglied.', 'assigned_to' => $support?->id,
            ],
            [
                'id' => '01m6c0r3q0a5k0000000000004', 'type' => PrivacyRequestType::Export, 'status' => PrivacyRequestStatus::Completed, 'source' => PrivacyRequestSource::Email,
                'user_id' => $tobi?->id, 'requester_name' => null, 'requester_email' => null, 'locale' => 'de',
                'details' => 'Bitte meine Daten als Datei zum Mitnehmen.',
                'received_at' => $at('2026-09-15 08:40'), 'due_at' => $at('2026-10-15 08:40'), 'completed_at' => $at('2026-09-18 16:20'), 'completed_by' => $admin?->id,
                'evidence_note' => 'Datenexport am 18.09.2026 an die Kontoadresse geschickt; das Mitglied hat den Eingang am selben Tag bestätigt.', 'assigned_to' => $admin?->id,
            ],
            [
                'id' => '01m6c0r3q0a5k0000000000005', 'type' => PrivacyRequestType::Erasure, 'status' => PrivacyRequestStatus::Open, 'source' => PrivacyRequestSource::Email,
                'user_id' => null, 'requester_name' => 'Sabine Krämer', 'requester_email' => 'sabine.kraemer@beispiel.de', 'locale' => 'en',
                'details' => 'Please delete everything you hold about me; I had an account with the e-mail above until last year.',
                'received_at' => $at('2026-10-28 11:00'), 'due_at' => $at('2026-11-28 11:00'), 'assigned_to' => null,
            ],
        ];

        // The role and anything else without a date of its own are dated $now, never the wall clock (DQ-677).
        SeedClock::at($now, fn () => DB::transaction(function () use ($rows, $admin, $now): void {
            foreach ($rows as $row) {
                PrivacyRequest::query()->whereKey($row['id'])->delete();
                $request = new PrivacyRequest;
                // Created when it came in, last changed with its latest step.
                $changed = $row['completed_at'] ?? $row['extended_at'] ?? $row['received_at'];
                $request->forceFill([...$row, 'created_by' => $admin?->id, 'created_at' => $row['received_at'], 'updated_at' => $changed])->save();
            }

            $role = Role::findOrCreate('Community-Team', StaffSeeder::GUARD);
            $role->forceFill(['description' => 'Beantwortet Support-Tickets und prüft gemeldete Fotos, ohne Entscheidungen über Konten.'])->save();
            $role->syncPermissions(['members.view', 'media.review', 'support.view', 'support.reply', 'support.macros', 'vehicles.view', 'qr.view']);
            app(PermissionRegistrar::class)->forgetCachedPermissions();

            DB::table('failed_jobs')->where('uuid', self::FAILED_JOB)->delete();
            DB::table('failed_jobs')->insert([
                'uuid' => self::FAILED_JOB,
                'connection' => 'database',
                'queue' => 'default',
                'payload' => json_encode(['uuid' => self::FAILED_JOB, 'displayName' => 'App\\Jobs\\BuildDataExport', 'job' => 'Illuminate\\Queue\\CallQueuedHandler@call', 'maxTries' => 3, 'data' => ['commandName' => 'App\\Jobs\\BuildDataExport']]),
                'exception' => 'Illuminate\\Http\\Client\\ConnectionException: Timeout while reaching the storage disk.',
                'failed_at' => $now->subHours(5)->utc(),
            ]);
        }));
    }
}
