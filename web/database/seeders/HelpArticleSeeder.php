<?php

namespace Database\Seeders;

use App\Models\HelpArticle;
use Database\Seeders\Concerns\SeedsFromData;
use Illuminate\Database\Seeder;
use RuntimeException;

/**
 * SET-14: the FAQ in German and English from database/data/help/{key}.{locale}.md, each with a --- block of title and sort. Safe in
 * production and safe to run again: an existing row is never touched, so an edit in ADM-32 survives.
 */
class HelpArticleSeeder extends Seeder
{
    use SeedsFromData;

    public function run(): void
    {
        $files = glob(database_path('data/help/*.md')) ?: [];
        $created = 0;

        foreach ($files as $file) {
            if (preg_match('/([a-z0-9-]+)\.(de|en)\.md\z/', $file, $name) !== 1) {
                continue;
            }

            $article = self::parse((string) file_get_contents($file), $file);

            $row = HelpArticle::query()->firstOrCreate(
                ['key' => $name[1], 'locale' => $name[2]],
                ['title' => $article['title'], 'body_md' => $article['body'], 'sort' => $article['sort'], 'published' => true],
            );

            $created += $row->wasRecentlyCreated ? 1 : 0;
        }

        $this->say("Help articles: {$created} new of ".count($files).'.');
    }

    /**
     * @return array{title: string, sort: int, body: string}
     */
    public static function parse(string $source, string $file = 'help article'): array
    {
        if (preg_match('/\A---\n(.*?)\n---\n(.*)\z/s', $source, $parts) !== 1) {
            throw new RuntimeException("[$file] has no --- metadata block.");
        }

        preg_match('/^title:\s*(.+)$/m', $parts[1], $title);
        preg_match('/^sort:\s*(\d+)$/m', $parts[1], $sort);

        if (! isset($title[1])) {
            throw new RuntimeException("[$file] has no title.");
        }

        return ['title' => trim($title[1]), 'sort' => (int) ($sort[1] ?? 0), 'body' => trim($parts[2])];
    }
}
