<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * DQ-572, ADR-240 (f): members never see a staff name, so support replies sign as the team. The seeded macros signed with the {staff}
 * variable, which no longer exists; their signature becomes "Dein SPEED-CLUB-Team" / "Your SPEED CLUB team". Macros staff wrote
 * themselves keep their wording, only a leftover {staff} is replaced the same way.
 */
return new class extends Migration
{
    public function up(): void
    {
        $signatures = [
            'de' => ['{staff} vom SPEED CLUB Team' => 'Dein SPEED-CLUB-Team', '{staff}' => 'Dein SPEED-CLUB-Team'],
            'en' => ['{staff} from the SPEED CLUB team' => 'Your SPEED CLUB team', '{staff}' => 'Your SPEED CLUB team'],
        ];

        foreach (DB::table('support_macros')->where('body', 'like', '%{staff}%')->orderBy('id')->get(['id', 'locale', 'body']) as $macro) {
            $map = $signatures[$macro->locale === 'en' ? 'en' : 'de'];
            DB::table('support_macros')->where('id', $macro->id)->update(['body' => strtr((string) $macro->body, $map)]);
        }
    }

    public function down(): void
    {
        // The staff variable is gone; nothing to restore.
    }
};
