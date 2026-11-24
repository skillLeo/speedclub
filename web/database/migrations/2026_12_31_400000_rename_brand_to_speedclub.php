<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Client round 2 (2026-11-19): the brand is written "Speedclub", without the gap. Rewrites the stored texts that show the old
 * spelling: badge descriptions, help articles, shop product texts, support macros and the editorial account's display name.
 * Published legal documents are versioned texts and change only with their next published version; member data (privacy
 * requests, members' own names) and the audit log stay as written.
 */
return new class extends Migration
{
    private const OLD = ['SPEED CLUB', 'SPEED-CLUB', "SPEED-\u{2060}CLUB", 'Speed Club', 'Speed club'];

    /** @var array<string, list<string>> */
    private const COLUMNS = [
        'badges' => ['description_de', 'description_en'],
        'help_articles' => ['title', 'body_md'],
        'shop_products' => ['title', 'description'],
        'support_macros' => ['title', 'body'],
    ];

    public function up(): void
    {
        foreach (self::COLUMNS as $table => $columns) {
            if (! Schema::hasTable($table)) {
                continue;
            }

            foreach ($columns as $column) {
                if (! Schema::hasColumn($table, $column)) {
                    continue;
                }

                // badges are keyed by `key`, the others by `id`.
                $primary = Schema::hasColumn($table, 'id') ? 'id' : 'key';
                $rows = DB::table($table)->where($column, 'like', '%SPEED%CLUB%')->orWhere($column, 'like', '%Speed Club%')->get([$primary, $column]);

                foreach ($rows as $row) {
                    $text = (string) $row->{$column};
                    $renamed = str_replace(self::OLD, 'Speedclub', $text);

                    if ($renamed !== $text) {
                        DB::table($table)->where($primary, $row->{$primary})->update([$column => $renamed]);
                    }
                }
            }
        }

        if (Schema::hasTable('users')) {
            foreach (DB::table('users')->where('is_editorial', true)->where('display_name', 'like', '%SPEED CLUB%')->get(['id', 'display_name']) as $user) {
                DB::table('users')->where('id', $user->id)->update(['display_name' => str_replace(self::OLD, 'Speedclub', (string) $user->display_name)]);
            }
        }
    }

    public function down(): void
    {
        // Spelling only; nothing to undo.
    }
};
