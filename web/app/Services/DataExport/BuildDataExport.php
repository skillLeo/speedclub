<?php

namespace App\Services\DataExport;

use App\Enums\DataExportStatus;
use App\Mail\DataExportReadyMail;
use App\Mail\SupportAddress;
use App\Models\DataExport;
use App\Models\User;
use App\Services\Auth\AuthMailer;
use App\Services\Auth\CredentialEpoch;
use App\Support\DisplayDate;
use Carbon\CarbonImmutable;
use Illuminate\Contracts\Filesystem\Filesystem;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Facades\URL;
use Throwable;

/**
 * One step of SET-12's export, then the next as a job of its own, so every job ends well inside the worker's 50 s (05_ARCHITECTURE
 * §11): "data" writes the JSON documents, "conversations" and "notifications" write keyset pages of JSON, "photos" copies originals in slices of speedclub.data_export.photos_per_job or job_seconds,
 * "finish" writes README.txt and the ZIP directory, marks the export ready and mails the signed link (valid 7 days).
 *
 * Restartable: progress (stage, ZIP offset, last photo id, entry count) is stored after each step, and the entries of the ZIP directory
 * in a sidecar file next to it. A retried job cuts the ZIP back to the stored offset and goes on from there.
 */
class BuildDataExport implements ShouldQueue
{
    use Queueable;

    public int $tries = 3;

    public int $timeout = 45;

    /**
     * @var list<int>
     */
    public array $backoff = [30, 120];

    public function __construct(public readonly string $exportId) {}

    public function handle(ExportContents $contents, AuthMailer $mailer): void
    {
        $export = DataExport::query()->find($this->exportId);

        if ($export === null || ! in_array($export->status, [DataExportStatus::Queued, DataExportStatus::Running], true)) {
            return;
        }

        $user = User::withTrashed()->find($export->user_id);

        if (! self::ownerMayExport($user)) {
            $this->discard($export);

            return;
        }

        /** @var User $user */
        $progress = $export->progress ?? [];
        $stage = $progress['stage'] ?? 'data';
        $offset = (int) ($progress['offset'] ?? 0);
        $entries = array_slice($this->readEntries($export), 0, (int) ($progress['entries'] ?? 0));

        if ($export->status === DataExportStatus::Queued) {
            $export->forceFill(['status' => DataExportStatus::Running, 'started_at' => now(), 'path' => self::zipPath($export)])->save();
        }

        $zip = new ZipAppender($this->disk()->path(self::zipPath($export)));
        $this->disk()->makeDirectory(dirname(self::zipPath($export)));
        $zip->open($offset);

        try {
            $next = match ($stage) {
                'data' => $this->data($zip, $contents, $user, $entries, $export->isForStaff()),
                'conversations', 'notifications' => $this->pages($zip, $contents, $user, $entries, $stage, $progress, $export->isForStaff()),
                'photos' => $this->photos($zip, $contents, $user, $entries, $progress['after_media_id'] ?? null, $export->isForStaff()),
                default => $this->finish($zip, $user, $entries, $export->isForStaff()),
            };
        } catch (Throwable $exception) {
            $zip->close();

            throw $exception;
        }

        // The row or its owner may have gone while this step ran (the account was hard-deleted, the row pruned): nothing stays behind.
        if (! $this->stillWanted($export)) {
            self::deleteFiles($export);

            return;
        }

        if ($next === null) {
            $this->ready($export, $user, $mailer);

            return;
        }

        $this->writeEntries($export, $next['entries']);
        $export->forceFill(['progress' => [
            'stage' => $next['stage'],
            'offset' => $next['offset'],
            'entries' => count($next['entries']),
            'after_media_id' => $next['after_media_id'] ?? null,
            'after' => $next['after'] ?? null,
            'part' => $next['part'] ?? 0,
            'photos' => (int) ($progress['photos'] ?? 0) + ($next['photos'] ?? 0),
        ]])->save();

        self::dispatch($export->id);
    }

    /**
     * An active member, or one whose deletion is pending: an export asked for before closing stays buildable and downloadable until its
     * expires_at (lead ruling, amends ADR-203 c). A staff deactivation or a hard-deleted account has nothing to export.
     */
    public static function ownerMayExport(?User $user): bool
    {
        return $user !== null && ! $user->trashed() && (! $user->isDeactivated() || $user->isPendingDeletion());
    }

    private function stillWanted(DataExport $export): bool
    {
        $fresh = DataExport::query()->find($export->id);

        return $fresh !== null
            && in_array($fresh->status, [DataExportStatus::Queued, DataExportStatus::Running], true)
            && self::ownerMayExport(User::withTrashed()->find($fresh->user_id));
    }

    public function failed(?Throwable $exception): void
    {
        $export = DataExport::query()->find($this->exportId);

        if ($export !== null) {
            $this->discard($export, DataExportStatus::Failed);
        }

        // The class only: messages may quote paths with ids.
        Log::warning('A data export failed.', ['type' => $exception === null ? null : $exception::class]);
    }

    public static function zipPath(DataExport $export): string
    {
        return config()->string('speedclub.data_export.directory').'/'.$export->id.'.zip';
    }

    /**
     * The ZIP and its sidecar, written or half written.
     */
    public static function deleteFiles(DataExport $export): void
    {
        $disk = Storage::disk('local');
        $disk->delete([self::zipPath($export), self::zipPath($export).'.entries.json']);
    }

    /**
     * @param  list<array{name: string, crc: int, size: int, offset: int, time: int, date: int}>  $entries
     * @return array{stage: string, offset: int, entries: list<array{name: string, crc: int, size: int, offset: int, time: int, date: int}>, after?: string|null, part?: int, after_media_id?: string|null, photos?: int}
     */
    private function data(ZipAppender $zip, ExportContents $contents, User $user, array $entries, bool $forStaff): array
    {
        foreach ($contents->documents($user, $forStaff) as $name => $document) {
            $entries[] = $zip->addString($name, $this->json($document));
        }

        $offset = $zip->offset();
        $zip->close();

        return ['stage' => 'conversations', 'offset' => $offset, 'entries' => $entries, 'after' => null, 'part' => 0];
    }

    /**
     * Conversations and notifications in keyset pages, one JSON file per page (conversations/0001.json …), until the stage is done or
     * job_seconds are up; a member with years of messages never holds a job past its budget (review should-fix 11).
     *
     * @param  list<array{name: string, crc: int, size: int, offset: int, time: int, date: int}>  $entries
     * @param  array<string, mixed>  $progress
     * @return array{stage: string, offset: int, entries: list<array{name: string, crc: int, size: int, offset: int, time: int, date: int}>, after?: string|null, part?: int, after_media_id?: string|null, photos?: int}
     */
    private function pages(ZipAppender $zip, ExportContents $contents, User $user, array $entries, string $stage, array $progress, bool $forStaff): array
    {
        $deadline = microtime(true) + max(1, config()->integer('speedclub.data_export.job_seconds'));
        $after = is_string($progress['after'] ?? null) ? $progress['after'] : null;
        $part = (int) ($progress['part'] ?? 0);
        $limit = $stage === 'conversations'
            ? max(1, config()->integer('speedclub.data_export.conversations_per_file'))
            : max(1, config()->integer('speedclub.data_export.chunk'));
        $done = false;

        while (microtime(true) < $deadline) {
            // The staff copy has no message of anybody (SEC-P3-01): conversation metadata only.
            $rows = match (true) {
                $stage !== 'conversations' => $contents->notificationsAfter($user, $after, $limit),
                $forStaff => $contents->conversationMetadataAfter($user, $after, $limit),
                default => $contents->conversationsAfter($user, $after, $limit),
            };

            if ($rows === []) {
                $done = true;

                break;
            }

            $part++;
            $entries[] = $zip->addString(sprintf('%s/%04d.json', $stage, $part), $this->json($rows));
            $last = $rows[array_key_last($rows)];
            $after = is_string($last['id'] ?? null) ? $last['id'] : $after;

            if (count($rows) < $limit) {
                $done = true;

                break;
            }
        }

        $offset = $zip->offset();
        $zip->close();

        if (! $done) {
            return ['stage' => $stage, 'offset' => $offset, 'entries' => $entries, 'after' => $after, 'part' => $part];
        }

        return $stage === 'conversations'
            ? ['stage' => 'notifications', 'offset' => $offset, 'entries' => $entries, 'after' => null, 'part' => 0]
            : ['stage' => 'photos', 'offset' => $offset, 'entries' => $entries, 'after_media_id' => null];
    }

    /**
     * @param  array<array-key, mixed>  $data
     */
    private function json(array $data): string
    {
        return (string) json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE);
    }

    /**
     * A slice of originals, by id after the last one copied. A missing file is skipped (photos.json still lists it).
     *
     * @param  list<array{name: string, crc: int, size: int, offset: int, time: int, date: int}>  $entries
     * @return array{stage: string, offset: int, entries: list<array{name: string, crc: int, size: int, offset: int, time: int, date: int}>, after?: string|null, part?: int, after_media_id?: string|null, photos?: int}
     */
    private function photos(ZipAppender $zip, ExportContents $contents, User $user, array $entries, ?string $after, bool $forStaff): array
    {
        $limit = max(1, config()->integer('speedclub.data_export.photos_per_job'));
        $deadline = microtime(true) + max(1, config()->integer('speedclub.data_export.job_seconds'));
        $disk = Storage::disk(config()->string('speedclub.media.private_disk'));

        $photos = $contents->photoQuery($user, $forStaff)
            ->when($after !== null, fn ($query) => $query->where('id', '>', $after))
            ->limit($limit + 1)
            ->get(['id', 'original_path']);

        $copied = 0;
        $last = $after;
        $stopped = false;

        foreach ($photos->take($limit) as $photo) {
            if (microtime(true) > $deadline) {
                $stopped = true;

                break;
            }

            $path = (string) $photo->original_path;
            $stream = $disk->exists($path) ? $disk->readStream($path) : null;

            if (is_resource($stream)) {
                try {
                    $entries[] = $zip->addStream(ExportContents::photoFile((string) $photo->id, $path), $stream);
                    $copied++;
                } finally {
                    fclose($stream);
                }
            }

            $last = (string) $photo->id;
        }

        $offset = $zip->offset();
        $zip->close();

        // Done when this slice reached the end: nothing beyond the limit, and no stop for time.
        $done = ! $stopped && $photos->count() <= $limit;

        return ['stage' => $done ? 'finish' : 'photos', 'offset' => $offset, 'entries' => $entries, 'after_media_id' => $last, 'photos' => $copied];
    }

    /**
     * @param  list<array{name: string, crc: int, size: int, offset: int, time: int, date: int}>  $entries
     */
    private function finish(ZipAppender $zip, User $user, array $entries, bool $forStaff): null
    {
        $entries[] = $zip->addString('README.txt', $this->readme($user, $forStaff));
        $zip->finish($entries);

        return null;
    }

    private function ready(DataExport $export, User $user, AuthMailer $mailer): void
    {
        // An export built for staff (M3.2, four-eyes members.export) is downloadable by the requester for the approval download window
        // and never mailed to the member.
        $expires = $export->isForStaff()
            ? CarbonImmutable::now()->addHours(config()->integer('speedclub.approvals.download_hours'))
            : CarbonImmutable::now()->addDays(config()->integer('speedclub.data_export.link_valid_days'));
        $path = self::zipPath($export);

        $export->forceFill([
            'status' => DataExportStatus::Ready,
            'ready_at' => now(),
            'expires_at' => $expires,
            'bytes' => (int) $this->disk()->size($path),
            'progress' => null,
        ])->save();

        $this->disk()->delete($path.'.entries.json');

        if ($export->isForStaff()) {
            return;
        }

        $locale = $user->getAttribute('locale');

        // The export stays ready and listed in SET-12 with its link, whether or not the mail got out.
        try {
            $mailer->send($user->email, is_string($locale) ? $locale : 'de', new DataExportReadyMail(self::downloadUrl($export, $user), $expires));
        } catch (Throwable $exception) {
            Log::error('The data export mail was not sent.', ['type' => $exception::class]);
        }
    }

    /** The purpose of the link's CredentialEpoch proof. */
    public const LINK_PURPOSE = 'data_export';

    /**
     * The signed link of the mail and of download_url. Besides the export it carries `c`, a keyed proof of the owner's credential epoch
     * (SEC-P2-02): the link ends with any sign-out of a device, a password reset, an e-mail change or the deletion, whoever read it.
     * A remaining session gets a fresh link from GET me/exports. $owner is the export's member, read again when not given.
     */
    public static function downloadUrl(DataExport $export, ?User $owner = null): string
    {
        $expires = $export->expires_at ?? now()->addDays(config()->integer('speedclub.data_export.link_valid_days'));
        $owner ??= User::withTrashed()->find($export->user_id);
        $parameters = ['export' => $export->id];

        if ($owner instanceof User) {
            $parameters['c'] = CredentialEpoch::proof($owner, self::LINK_PURPOSE, $export->id);
        }

        return URL::temporarySignedRoute('api.v1.me.exports.download', $expires, $parameters);
    }

    /**
     * Whether the link's proof still matches the owner's credential epoch.
     */
    public static function linkStillValid(DataExport $export, User $owner, mixed $proof): bool
    {
        return CredentialEpoch::matches($owner, self::LINK_PURPOSE, $export->id, $proof);
    }

    private function discard(DataExport $export, ?DataExportStatus $status = null): void
    {
        self::deleteFiles($export);

        if ($status === null) {
            $export->delete();

            return;
        }

        $export->forceFill(['status' => $status, 'failed_at' => now(), 'progress' => null])->save();
    }

    private function readme(User $user, bool $forStaff = false): string
    {
        $text = '';

        foreach (['de', 'en'] as $locale) {
            $lines = [
                (string) __('settings.export.readme.title', [], $locale),
                str_repeat('=', 40),
                '',
                (string) __('settings.export.readme.created', ['date' => DisplayDate::format(now()), 'username' => $user->username ?? '–', 'email' => $user->email], $locale),
                '',
                (string) __('settings.export.readme.intro', [], $locale),
                '',
            ];

            /** @var array<string, string> $files */
            $files = trans('settings.export.readme.files', [], $locale);

            foreach ($files as $file => $description) {
                $lines[] = '- '.$file.': '.$description;
            }

            $lines[] = '';
            $lines[] = (string) __('settings.export.readme.not_included', [], $locale);

            if ($forStaff) {
                $lines[] = (string) __('settings.export.readme.staff_copy', [], $locale);
            }

            $lines[] = (string) __('settings.export.readme.questions', ['support' => SupportAddress::get()], $locale);

            $text .= implode("\r\n", $lines)."\r\n\r\n";
        }

        return $text;
    }

    /**
     * @return list<array{name: string, crc: int, size: int, offset: int, time: int, date: int}>
     */
    private function readEntries(DataExport $export): array
    {
        $json = $this->disk()->get(self::zipPath($export).'.entries.json');
        $entries = is_string($json) ? json_decode($json, true) : null;

        /** @var list<array{name: string, crc: int, size: int, offset: int, time: int, date: int}> */
        return is_array($entries) ? array_values($entries) : [];
    }

    /**
     * @param  list<array{name: string, crc: int, size: int, offset: int, time: int, date: int}>  $entries
     */
    private function writeEntries(DataExport $export, array $entries): void
    {
        $this->disk()->put(self::zipPath($export).'.entries.json', (string) json_encode($entries));
    }

    private function disk(): Filesystem
    {
        return Storage::disk('local');
    }
}
