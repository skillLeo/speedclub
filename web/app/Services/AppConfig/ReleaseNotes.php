<?php

namespace App\Services\AppConfig;

use Illuminate\Support\Facades\Cache;

/**
 * SET-25 "Was ist neu" (09 §7.12): the member-facing release notes of database/data/release_notes.json, newest first, in the language
 * asked for (German when there is no text in it). The file ships with the code, so a deploy is its only change; it is read once per
 * deploy and locale (cached by the file's modification time).
 *
 * @phpstan-type Note array{version: string, date: string, title: string, items: list<string>}
 */
final class ReleaseNotes
{
    private const FALLBACK = 'de';

    /**
     * @return list<Note>
     */
    public function all(string $locale): array
    {
        $path = (string) config('speedclub.release_notes_path', database_path('data/release_notes.json'));

        if (! is_file($path)) {
            return [];
        }

        return Cache::remember('release-notes:'.$locale.':'.filemtime($path).':'.md5($path), now()->addDay(), fn (): array => $this->read($path, $locale));
    }

    /**
     * @return list<Note>
     */
    private function read(string $path, string $locale): array
    {
        $data = json_decode((string) file_get_contents($path), true);
        $notes = [];

        foreach (is_array($data) && is_array($data['releases'] ?? null) ? $data['releases'] : [] as $release) {
            if (! is_array($release) || ! is_string($release['version'] ?? null) || ! is_string($release['date'] ?? null)) {
                continue;
            }

            $text = is_array($release[$locale] ?? null) ? $release[$locale] : ($release[self::FALLBACK] ?? null);

            if (! is_array($text) || ! is_string($text['title'] ?? null) || ! is_array($text['items'] ?? null)) {
                continue;
            }

            $notes[] = [
                'version' => $release['version'],
                'date' => $release['date'],
                'title' => $text['title'],
                'items' => array_values(array_filter($text['items'], is_string(...))),
            ];
        }

        usort($notes, fn (array $a, array $b): int => [$b['date'], $b['version']] <=> [$a['date'], $a['version']]);

        return $notes;
    }
}
