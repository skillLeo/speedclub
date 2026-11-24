<?php

use App\Services\Forum\ForumMarkdown;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * M5.8 review SF-5: the parsed Markdown tree of a post (ForumMarkdown::blocks) is stored when the post is written or edited, so a page
 * of replies never parses CommonMark per request. Existing posts are filled in chunks.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasColumn('forum_posts', 'content')) {
            Schema::table('forum_posts', function (Blueprint $table) {
                $table->json('content')->nullable()->after('body');
            });
        }

        $markdown = app(ForumMarkdown::class);

        DB::table('forum_posts')->whereNull('content')->orderBy('id')->chunkById(200, function ($posts) use ($markdown): void {
            foreach ($posts as $post) {
                DB::table('forum_posts')->where('id', $post->id)->update(['content' => json_encode($markdown->blocks((string) $post->body))]);
            }
        });
    }

    public function down(): void
    {
        Schema::table('forum_posts', function (Blueprint $table) {
            $table->dropColumn('content');
        });
    }
};
