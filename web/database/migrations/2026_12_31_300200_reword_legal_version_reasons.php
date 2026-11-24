<?php

use App\Enums\ContentEvent;
use App\Models\LegalDocument;
use App\Services\Audit\Audit;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * DQ-P5-103 (Phase 5 gate): ADM-31's "Grund" column showed the reasons the legal publish migrations stored, written for the tracker
 * ("Phase-5-Datenschutz (M5.5 Shop, …; BL-21, OA-35)"). Those migrations now carry plain German; this one gives the rows they already
 * wrote on dev and staging the same words. Only a reason that is exactly one of the old texts changes (a reason staff typed is never
 * touched); each changed row is audited as `legal.reason_reworded` by the system. The audit log keeps its history as written. Running
 * it again finds nothing to change.
 */
return new class extends Migration
{
    /** @var array<string, string> the old reason => the migration whose REASON replaces it */
    public const REWORDED = [
        'Schriften 2.0 (ADR-402): Inter Display und Archivo statt Barlow Semi Condensed. Nur Lizenzangaben, keine erneute Zustimmung.' => '2026_11_25_100000_publish_licences_with_the_2_0_typefaces',
        'Phase-4-Entwürfe (M4.18, OA-35): neue Funktionen in Datenschutz, AGB, Community-Richtlinien und Impressum. Entwurf, rechtliche Prüfung ausstehend; keine erneute Zustimmung.' => '2026_12_09_100000_publish_phase_4_legal_drafts',
        'STREET DEX (M5.9b, ADR-508): Namensnennung der Ortsdaten von GeoNames (CC BY 4.0). Nur Lizenzangaben, keine erneute Zustimmung.' => '2026_12_16_120000_publish_licences_with_geonames',
        'Phase-5-Entwürfe (M5.9f, OA-35): Geschenk-Funktionen von SPEED CLUB 2.1 in Datenschutz, AGB und Community-Richtlinien. Entwurf, rechtliche Prüfung ausstehend; keine erneute Zustimmung.' => '2026_12_21_100000_publish_phase_5_legal_drafts',
        'Phase-5-Datenschutz (M5.5 Shop, M5.6 Treffen, M5.7 Aufrufe und Wochenrückblick, M5.8 Forum; BL-21, OA-35): Entwurf, rechtliche Prüfung ausstehend; keine erneute Zustimmung.' => '2026_12_29_100300_publish_phase_5_privacy_update',
        'Phase-5-Datenschutz, KI-Funktionen (M5.9): Herstellerangaben, Teile-Zuordnung und Zusammenfassungen im Forum. Entwurf, rechtliche Prüfung ausstehend (OA-35); keine erneute Zustimmung.' => '2026_12_31_200200_publish_phase_5_ai_privacy',
    ];

    public const AUDIT_REASON = 'Grund ohne interne Kennungen formuliert.';

    public function up(): void
    {
        $this->reword();
    }

    /** Returns how many rows it changed. */
    public function reword(): int
    {
        $changed = 0;

        foreach (self::REWORDED as $old => $migration) {
            $new = self::newReason($migration);

            $changed += DB::transaction(function () use ($old, $new): int {
                $rows = LegalDocument::query()->where('reason', $old)->lockForUpdate()->get();

                foreach ($rows as $row) {
                    $row->forceFill(['reason' => $new])->save();
                    Audit::record(ContentEvent::LegalReasonReworded->value, $row,
                        before: ['key' => $row->key->value, 'locale' => $row->locale, 'version' => $row->version, 'reason' => $old],
                        after: ['key' => $row->key->value, 'locale' => $row->locale, 'version' => $row->version, 'reason' => $new],
                        reason: self::AUDIT_REASON);
                }

                return $rows->count();
            });
        }

        return $changed;
    }

    /** The REASON a publish migration stores now. */
    public static function newReason(string $migration): string
    {
        $instance = require database_path("migrations/$migration.php");
        $reason = constant($instance::class.'::REASON');

        return is_string($reason) ? $reason : throw new RuntimeException("Migration [$migration] has no REASON.");
    }

    /**
     * The old wording named internal IDs; nothing to restore.
     */
    public function down(): void {}
};
