<?php

use App\Models\LegalDocument;
use App\Services\Content\LegalDrafts;
use Database\Seeders\Concerns\LegalDraftRepair;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * DQ-P5-101 (Phase 5 gate): an ADM-31 draft remembers the published version it was started from (`based_on_id`, set by SaveLegalDraft),
 * so a draft that is older than the live text is shown as stale and can no longer be published (PublishLegalDocument). Every open draft
 * gets its base here: the newest published version whose text it holds unchanged (the demo sentence aside, LegalDraftRepair), else the
 * version that was live when it was created. Only the new column is written; updated_at and the audit log stay as they are (no content
 * changes). 2026_12_31_300100 then moves stale drafts without own text onto the live text.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasColumn('legal_documents', 'based_on_id')) {
            Schema::table('legal_documents', function (Blueprint $table) {
                $table->foreignId('based_on_id')->nullable()->after('version')->constrained('legal_documents')->nullOnDelete();
            });
        }

        $this->backfill();
    }

    /**
     * Sets the base of every open draft that has none; returns how many it set.
     */
    public function backfill(): int
    {
        $filled = 0;

        foreach (LegalDocument::query()->whereNull('published_at')->whereNull('based_on_id')->get() as $draft) {
            $rows = LegalDocument::query()->where('key', $draft->key)->where('locale', $draft->locale)->get();
            $base = LegalDraftRepair::untouchedBase($draft, $rows) ?? LegalDrafts::base($draft);

            if ($base !== null) {
                DB::table('legal_documents')->where('id', $draft->id)->update(['based_on_id' => $base->id]);
                $filled++;
            }
        }

        return $filled;
    }

    public function down(): void
    {
        Schema::table('legal_documents', function (Blueprint $table) {
            $table->dropConstrainedForeignId('based_on_id');
        });
    }
};
