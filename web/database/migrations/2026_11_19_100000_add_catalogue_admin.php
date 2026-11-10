<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * M3.3 Catalogue admin (m3.3 contract §1, §1a; 06_ADMIN_SPEC §3 Catalogue):
 *
 * - makes, vehicle_models, generations: `merged_into_id`. A merged row stays as the alias of its slug: it is inactive, nothing points
 *   at it once the relink job ran, and every slug lookup (App\Services\Catalog\CatalogSlugs) answers its survivor. Chains are flattened
 *   at each merge, so one hop always reaches the survivor. Restrict on delete: a survivor with aliases is never deleted.
 * - generations: `active` (the other two levels had it), hidden from pickers and new vehicles, still shown on existing builds.
 * - mod_category_fields: `archived_at` (a field with data is archived, never deleted).
 * - mod_category_schema_versions: one row per change to a category's fields, the whole schema after it.
 * - catalog_imports: the ADM-17 CSV imports, their dry run, the queued apply's progress and per-row results; the file stays on the
 *   private disk for 30 days.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('makes', function (Blueprint $table) {
            $table->foreignId('merged_into_id')->nullable()->after('active')->constrained('makes')->restrictOnDelete();
        });

        Schema::table('vehicle_models', function (Blueprint $table) {
            $table->foreignId('merged_into_id')->nullable()->after('active')->constrained('vehicle_models')->restrictOnDelete();
        });

        Schema::table('generations', function (Blueprint $table) {
            $table->boolean('active')->default(true)->after('slug')->index();
            $table->foreignId('merged_into_id')->nullable()->after('active')->constrained('generations')->restrictOnDelete();
        });

        Schema::table('mod_category_fields', function (Blueprint $table) {
            $table->timestamp('archived_at')->nullable()->after('sort')->index();
        });

        Schema::create('mod_category_schema_versions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('category_id')->constrained('mod_categories')->cascadeOnDelete();
            $table->unsignedInteger('version');
            $table->json('schema');
            $table->foreignId('staff_id')->nullable()->constrained('staff')->nullOnDelete();
            $table->string('reason', 1000)->nullable();
            $table->timestamp('created_at')->nullable();

            $table->unique(['category_id', 'version']);
        });

        Schema::create('catalog_imports', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->string('kind', 20);
            $table->string('status', 20)->index();
            $table->string('original_name', 255);
            $table->string('path', 255);
            $table->char('file_hash', 64);
            $table->unsignedInteger('row_count')->default(0);
            $table->json('counts')->nullable();
            $table->json('rows')->nullable();
            $table->json('results')->nullable();
            $table->unsignedInteger('progress')->default(0);
            $table->string('reason', 1000)->nullable();
            $table->foreignId('created_by')->nullable()->constrained('staff')->nullOnDelete();
            $table->foreignId('applied_by')->nullable()->constrained('staff')->nullOnDelete();
            $table->foreignId('approved_by')->nullable()->constrained('staff')->nullOnDelete();
            $table->foreignUlid('approval_id')->nullable()->constrained('approval_requests')->nullOnDelete();
            $table->timestamp('queued_at')->nullable();
            $table->timestamp('started_at')->nullable();
            $table->timestamp('finished_at')->nullable();
            $table->timestamp('expires_at')->nullable()->index();
            $table->timestamps();

            $table->index(['status', 'updated_at']);
            $table->index('created_at');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('catalog_imports');
        Schema::dropIfExists('mod_category_schema_versions');

        Schema::table('mod_category_fields', function (Blueprint $table) {
            $table->dropIndex(['archived_at']);
            $table->dropColumn('archived_at');
        });

        Schema::table('generations', function (Blueprint $table) {
            $table->dropConstrainedForeignId('merged_into_id');
            $table->dropIndex(['active']);
            $table->dropColumn('active');
        });

        Schema::table('vehicle_models', function (Blueprint $table) {
            $table->dropConstrainedForeignId('merged_into_id');
        });

        Schema::table('makes', function (Blueprint $table) {
            $table->dropConstrainedForeignId('merged_into_id');
        });
    }
};
