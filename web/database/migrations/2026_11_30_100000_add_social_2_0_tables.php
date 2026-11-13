<?php

use App\Enums\BuildUpdateAudience;
use App\Enums\CommentStatus;
use App\Enums\MentionPrivacy;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * M4.11 Social 2.0 (09 §8.5, §8.6, §11). Build updates 2.0 (text up to 2,000 characters, mileage, date, audience, edit stamp, sample
 * flag, before/after pairs, linked mods), private reactions, mentions, comments [build_comments], highlights, member collections
 * ("collections" already names DISC-01's curated collections, so these are member_collections) and vehicle follows. Plain columns and
 * indexes for every foreign key and filter: MySQL 8 and MariaDB 10.6+. Reversible.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('build_updates', function (Blueprint $table) {
            $table->string('note', 2000)->nullable()->change();
            $table->unsignedInteger('mileage_km')->nullable();
            $table->date('happened_on')->nullable();
            $table->string('audience', 20)->default(BuildUpdateAudience::Vehicle->value);
            // Before/after pairs of the update's photos: [[before_media_id, after_media_id], …].
            $table->json('photo_pairs')->nullable();
            $table->timestamp('edited_at')->nullable();
            $table->boolean('is_sample')->default(false)->index();

            $table->index(['vehicle_id', 'audience']);
        });

        // 09 §11: is_sample on build updates, from their vehicle (or its owner) for what exists already.
        DB::table('build_updates')
            ->whereIn('vehicle_id', DB::table('vehicles')->select('vehicles.id')->join('users', 'users.id', '=', 'vehicles.owner_id')
                ->where(fn ($sample) => $sample->where('vehicles.is_sample', true)->orWhere('users.is_sample', true)))
            ->update(['is_sample' => true]);

        Schema::table('vehicles', function (Blueprint $table) {
            // [build_comments] the owner can turn comments off per vehicle.
            $table->boolean('comments_enabled')->default(true);
        });

        Schema::table('users', function (Blueprint $table) {
            $table->string('mention_privacy', 20)->default(MentionPrivacy::Everyone->value);
        });

        Schema::create('build_update_modifications', function (Blueprint $table) {
            $table->id();
            $table->foreignUlid('build_update_id')->constrained()->cascadeOnDelete();
            $table->foreignUlid('modification_id')->constrained()->cascadeOnDelete();
            $table->unsignedSmallInteger('position')->default(0);

            $table->unique(['build_update_id', 'modification_id'], 'bu_mods_update_mod_unique');
            $table->index('modification_id');
        });

        Schema::create('reactions', function (Blueprint $table) {
            $table->id();
            $table->foreignUlid('user_id')->constrained()->cascadeOnDelete();
            $table->string('reactable_type', 30);
            $table->ulid('reactable_id');
            $table->string('type', 10);
            $table->timestamps();

            $table->unique(['user_id', 'reactable_type', 'reactable_id'], 'reactions_member_item_unique');
            $table->index(['reactable_type', 'reactable_id', 'created_at'], 'reactions_item_created_index');
        });

        Schema::create('mentions', function (Blueprint $table) {
            $table->id();
            $table->string('mentionable_type', 30);
            $table->ulid('mentionable_id');
            $table->foreignUlid('mentioned_user_id')->constrained('users')->cascadeOnDelete();
            $table->foreignUlid('author_id')->constrained('users')->cascadeOnDelete();
            $table->timestamp('created_at')->nullable();

            $table->unique(['mentionable_type', 'mentionable_id', 'mentioned_user_id'], 'mentions_item_member_unique');
            $table->index(['mentioned_user_id', 'created_at']);
            $table->index(['author_id', 'created_at']);
        });

        Schema::create('comments', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->foreignUlid('build_update_id')->constrained()->cascadeOnDelete();
            $table->foreignUlid('user_id')->constrained()->cascadeOnDelete();
            $table->foreignUlid('parent_id')->nullable()->constrained('comments')->cascadeOnDelete();
            $table->string('body', 500);
            $table->string('status', 20)->default(CommentStatus::Visible->value);
            $table->timestamps();
            $table->softDeletes();

            $table->index(['build_update_id', 'status', 'created_at']);
            $table->index(['user_id', 'created_at']);
        });

        Schema::create('vehicle_highlights', function (Blueprint $table) {
            $table->id();
            $table->foreignUlid('vehicle_id')->constrained()->cascadeOnDelete();
            $table->string('item_type', 30);
            $table->ulid('item_id');
            $table->unsignedTinyInteger('position')->default(0);
            $table->timestamp('created_at')->nullable();

            $table->unique(['vehicle_id', 'item_type', 'item_id']);
            $table->index(['vehicle_id', 'position']);
            $table->index(['item_type', 'item_id']);
        });

        Schema::create('member_collections', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->foreignUlid('user_id')->constrained()->cascadeOnDelete();
            // Null for the default collection while the member has not renamed it: shown as "Gespeichert" / "Saved" in their language.
            $table->string('name', 60)->nullable();
            $table->boolean('is_default')->default(false);
            $table->unsignedInteger('position')->default(0);
            $table->timestamps();

            $table->index(['user_id', 'is_default']);
            $table->index(['user_id', 'position']);
        });

        Schema::create('member_collection_items', function (Blueprint $table) {
            $table->id();
            $table->foreignUlid('collection_id')->constrained('member_collections')->cascadeOnDelete();
            $table->string('item_type', 30);
            $table->ulid('item_id');
            $table->unsignedInteger('position')->default(0);
            $table->timestamp('created_at')->nullable();

            $table->unique(['collection_id', 'item_type', 'item_id'], 'collection_items_item_unique');
            $table->index(['collection_id', 'position']);
            $table->index(['item_type', 'item_id']);
        });

        Schema::create('vehicle_follows', function (Blueprint $table) {
            $table->id();
            $table->foreignUlid('user_id')->constrained()->cascadeOnDelete();
            $table->foreignUlid('vehicle_id')->constrained()->cascadeOnDelete();
            $table->timestamp('created_at')->nullable();

            $table->unique(['user_id', 'vehicle_id']);
            $table->index(['vehicle_id', 'user_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('vehicle_follows');
        Schema::dropIfExists('member_collection_items');
        Schema::dropIfExists('member_collections');
        Schema::dropIfExists('vehicle_highlights');
        Schema::dropIfExists('comments');
        Schema::dropIfExists('mentions');
        Schema::dropIfExists('reactions');
        Schema::dropIfExists('build_update_modifications');

        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn('mention_privacy');
        });

        Schema::table('vehicles', function (Blueprint $table) {
            $table->dropColumn('comments_enabled');
        });

        // Texts longer than the old 500 characters are cut, so the column can shrink again.
        DB::table('build_updates')->whereRaw('CHAR_LENGTH(note) > 500')->update(['note' => DB::raw('LEFT(note, 500)')]);

        Schema::table('build_updates', function (Blueprint $table) {
            $table->dropIndex(['vehicle_id', 'audience']);
            $table->dropIndex(['is_sample']);
            $table->dropColumn(['mileage_km', 'happened_on', 'audience', 'photo_pairs', 'edited_at', 'is_sample']);
        });

        Schema::table('build_updates', function (Blueprint $table) {
            $table->string('note', 500)->nullable()->change();
        });
    }
};
