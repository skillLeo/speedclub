<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * M4.17 part 2 (09 §10.2, §8.19):
 * - admin_saved_views.shared_role: a saved view shared with every staff member of that role (null = personal). Only its author changes
 *   or deletes it; the unique (staff_id, table_key, name) stays, so a shared view is still one of its author's views.
 * - sample_hidden_items (ADM-58): a sample build, meet or business staff took out of every member-facing read while the
 *   editorial_samples flag stays on. Hiding uses each item's own withdrawal that every read path honours already (a build goes private,
 *   a meet or business gets removed_at); `previous` keeps what to restore, `restored_at` closes the row when it is shown again.
 * - activity_days.push_members / push_base: the daily Push-Opt-in snapshot (members active in 30 days with an app push token or a
 *   browser subscription, and those active members), so the dashboard tile has a history instead of an invented one.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('admin_saved_views', function (Blueprint $table): void {
            $table->string('shared_role', 60)->nullable()->after('name');
            $table->index(['table_key', 'shared_role']);
        });

        Schema::create('sample_hidden_items', function (Blueprint $table): void {
            $table->ulid('id')->primary();
            $table->string('subject_type', 20);
            $table->string('subject_id', 26)->charset('ascii')->collation('ascii_bin');
            $table->json('previous');
            $table->string('reason', 1000);
            $table->foreignId('hidden_by')->nullable()->constrained('staff')->nullOnDelete();
            $table->timestamp('hidden_at');
            $table->foreignId('restored_by')->nullable()->constrained('staff')->nullOnDelete();
            $table->timestamp('restored_at')->nullable();

            $table->index(['subject_type', 'subject_id', 'restored_at']);
        });

        Schema::table('activity_days', function (Blueprint $table): void {
            $table->unsignedInteger('push_members')->nullable();
            $table->unsignedInteger('push_base')->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('activity_days', function (Blueprint $table): void {
            $table->dropColumn(['push_members', 'push_base']);
        });

        Schema::dropIfExists('sample_hidden_items');

        Schema::table('admin_saved_views', function (Blueprint $table): void {
            $table->dropIndex(['table_key', 'shared_role']);
            $table->dropColumn('shared_role');
        });
    }
};
