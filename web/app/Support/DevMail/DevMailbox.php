<?php

namespace App\Support\DevMail;

use Illuminate\Contracts\Filesystem\Filesystem;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

/**
 * Sent mails as JSON files on a private disk, for the local preview only. Nothing in a production path reads or writes this.
 *
 * @phpstan-type DevMail array{at: string, to: list<string>, subject: string, html: string, text: string, code: string|null}
 */
final class DevMailbox
{
    /**
     * @param  DevMail  $mail
     */
    public function store(array $mail): void
    {
        // The name sorts by time, and files are never rewritten, so a reader never sees half of one.
        $name = now('UTC')->format('YmdHisu').'-'.Str::ulid().'.json';

        $this->disk()->put($this->directory().'/'.$name, (string) json_encode($mail, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE));

        foreach (array_slice($this->files(), config()->integer('speedclub.dev_mail.keep')) as $old) {
            $this->disk()->delete($old);
        }
    }

    /**
     * @return list<DevMail> newest first
     */
    public function recent(int $limit = 50): array
    {
        $mails = [];

        foreach (array_slice($this->files(), 0, $limit) as $file) {
            $mail = $this->read($file);

            if ($mail !== null) {
                $mails[] = $mail;
            }
        }

        return $mails;
    }

    /**
     * @return DevMail|null
     */
    public function latestTo(string $address): ?array
    {
        $address = mb_strtolower(trim($address));

        foreach ($this->files() as $file) {
            $mail = $this->read($file);

            if ($mail !== null && in_array($address, array_map(mb_strtolower(...), $mail['to']), true)) {
                return $mail;
            }
        }

        return null;
    }

    /**
     * @return list<string> newest first
     */
    private function files(): array
    {
        $files = $this->disk()->files($this->directory());
        rsort($files, SORT_STRING);

        return $files;
    }

    /**
     * @return DevMail|null
     */
    private function read(string $file): ?array
    {
        $mail = json_decode((string) $this->disk()->get($file), true);

        /** @var DevMail|null $mail */
        return is_array($mail) ? $mail : null;
    }

    private function directory(): string
    {
        return config()->string('speedclub.dev_mail.directory');
    }

    private function disk(): Filesystem
    {
        return Storage::disk(config()->string('speedclub.dev_mail.disk'));
    }
}
