<?php

use App\Enums\ForumCategoryKind;
use App\Enums\ForumPostStatus;
use App\Enums\ForumThreadStatus;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * M5.8 Forum (10 §7, ADR-506, m5.8-contract §1): admin-managed categories with one level of sub-categories, threads whose text is
 * their opening post, replies with one level of nesting, private "Hilfreich" votes whose count shows in the forum only, and
 * subscriptions. Search without FULLTEXT (title_keys, search_keys: SearchTerms word keys, matched by LIKE on both MySQL 8 and
 * MariaDB 10.6). Every foreign key and filter column is indexed.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('forum_categories', function (Blueprint $table) {
            $table->id();
            $table->foreignId('parent_id')->nullable()->constrained('forum_categories')->restrictOnDelete();
            $table->string('slug', 80)->unique();
            $table->string('kind', 20)->default(ForumCategoryKind::Standard->value);
            $table->foreignId('make_id')->nullable()->unique()->constrained('makes')->nullOnDelete();
            $table->char('bundesland', 2)->nullable()->unique();
            $table->string('name_de', 80);
            $table->string('name_en', 80);
            $table->string('description_de', 300)->nullable();
            $table->string('description_en', 300)->nullable();
            $table->string('icon', 40)->nullable();
            $table->unsignedSmallInteger('sort')->default(0);
            $table->boolean('is_active')->default(true);
            $table->unsignedInteger('threads_count')->default(0);
            $table->timestamps();

            $table->index(['parent_id', 'sort']);
            $table->index(['is_active', 'sort']);
        });

        Schema::create('forum_threads', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->foreignId('category_id')->constrained('forum_categories')->restrictOnDelete();
            $table->foreignUlid('user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->string('title', 120);
            $table->string('slug', 140);
            $table->string('status', 20)->default(ForumThreadStatus::Published->value);
            $table->json('tags')->nullable();
            $table->foreignUlid('vehicle_id')->nullable()->constrained('vehicles')->nullOnDelete();
            $table->foreignUlid('modification_id')->nullable()->constrained('modifications')->nullOnDelete();
            $table->foreignUlid('product_id')->nullable()->constrained('products')->nullOnDelete();
            $table->boolean('is_pinned')->default(false);
            $table->timestamp('pinned_at')->nullable();
            $table->boolean('is_locked')->default(false);
            $table->timestamp('locked_at')->nullable();
            // FK to forum_posts below, once that table exists.
            $table->ulid('solved_post_id')->nullable()->index();
            $table->timestamp('solved_at')->nullable();
            $table->foreignUlid('merged_into_id')->nullable()->constrained('forum_threads')->nullOnDelete();
            $table->unsignedInteger('replies_count')->default(0);
            $table->timestamp('last_activity_at')->nullable();
            // Denormalised for the row ("zuletzt @name"): no FK, a stale id only shows nobody.
            $table->ulid('last_post_id')->nullable();
            $table->ulid('last_poster_id')->nullable();
            $table->string('title_keys', 600)->default('');
            $table->text('search_keys')->nullable();
            $table->timestamp('published_at')->nullable();
            $table->timestamp('edited_at')->nullable();
            $table->string('review_reason', 1000)->nullable();
            $table->unsignedBigInteger('reviewed_by')->nullable();
            $table->timestamp('reviewed_at')->nullable();
            $table->boolean('is_sample')->default(false)->index();
            $table->timestamps();
            $table->softDeletes();

            $table->index(['status', 'is_pinned', 'last_activity_at'], 'forum_threads_active_index');
            $table->index(['status', 'published_at']);
            $table->index(['status', 'replies_count', 'published_at'], 'forum_threads_unanswered_index');
            $table->index(['status', 'solved_at']);
            $table->index(['category_id', 'status', 'is_pinned', 'last_activity_at'], 'forum_threads_category_index');
            $table->index(['user_id', 'created_at']);
        });

        Schema::create('forum_posts', function (Blueprint $table) {
            $table->ulid('id')->primary();
            $table->foreignUlid('thread_id')->constrained('forum_threads')->cascadeOnDelete();
            $table->foreignUlid('user_id')->constrained('users')->cascadeOnDelete();
            $table->foreignUlid('parent_id')->nullable()->constrained('forum_posts')->cascadeOnDelete();
            $table->boolean('is_opening')->default(false);
            $table->text('body');
            $table->string('status', 20)->default(ForumPostStatus::Published->value);
            $table->unsignedInteger('helpful_count')->default(0);
            $table->timestamp('published_at')->nullable();
            $table->timestamp('edited_at')->nullable();
            $table->string('review_reason', 1000)->nullable();
            $table->unsignedBigInteger('reviewed_by')->nullable();
            $table->timestamp('reviewed_at')->nullable();
            $table->boolean('is_sample')->default(false);
            $table->timestamps();
            $table->softDeletes();

            $table->index(['thread_id', 'status', 'parent_id', 'created_at'], 'forum_posts_thread_index');
            $table->index(['thread_id', 'status', 'helpful_count'], 'forum_posts_helpful_index');
            $table->index(['user_id', 'created_at']);
            $table->index(['status', 'created_at']);
        });

        Schema::table('forum_threads', function (Blueprint $table) {
            $table->foreign('solved_post_id')->references('id')->on('forum_posts')->nullOnDelete();
        });

        Schema::create('forum_votes', function (Blueprint $table) {
            $table->foreignUlid('post_id')->constrained('forum_posts')->cascadeOnDelete();
            $table->foreignUlid('user_id')->constrained('users')->cascadeOnDelete();
            $table->timestamp('created_at')->nullable();

            $table->primary(['post_id', 'user_id']);
            $table->index('user_id');
        });

        Schema::create('forum_subscriptions', function (Blueprint $table) {
            $table->foreignUlid('thread_id')->constrained('forum_threads')->cascadeOnDelete();
            $table->foreignUlid('user_id')->constrained('users')->cascadeOnDelete();
            $table->timestamp('created_at')->nullable();

            $table->primary(['thread_id', 'user_id']);
            $table->index(['user_id', 'created_at']);
        });
    }

    public function down(): void
    {
        Schema::table('forum_threads', function (Blueprint $table) {
            $table->dropForeign(['solved_post_id']);
        });
        Schema::dropIfExists('forum_subscriptions');
        Schema::dropIfExists('forum_votes');
        Schema::dropIfExists('forum_posts');
        Schema::dropIfExists('forum_threads');
        Schema::dropIfExists('forum_categories');
    }
};
