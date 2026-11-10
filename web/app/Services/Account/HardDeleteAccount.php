<?php

namespace App\Services\Account;

use App\Enums\MemberSecurityEvent;
use App\Enums\QrRevocationReason;
use App\Enums\UserStatus;
use App\Models\DataExport;
use App\Models\Media;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\Audit\Audit;
use App\Services\Auth\MemberSessions;
use App\Services\DataExport\BuildDataExport;
use App\Services\Media\MediaService;
use App\Services\Privacy\RetentionPolicy;
use App\Services\PublicPages\OgImages;
use App\Services\Qr\QrCodes;
use Illuminate\Contracts\Queue\ShouldBeUniqueUntilProcessing;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\DB;
use Throwable;

/**
 * The end of SET-13's 30 days (06_ADMIN_SPEC §4): every photo with its private original (DeleteAllMedia's hard half, ADR-123), the
 * vehicles with specs, mods and Verlauf, the exports, then the account row, which takes follows, blocks, saves, notifications, push
 * tokens and its conversation seats with it. Messages keep their rows with a null sender ("Gelöschtes Mitglied" for the other side),
 * QR codes stay as revoked tombstones without a vehicle. The audit log keeps the event, with the system as actor.
 *
 * Photos go in slices within job_seconds; a slice that runs out of time queues the job again. Idempotent: a retry continues.
 */
class HardDeleteAccount implements ShouldBeUniqueUntilProcessing, ShouldQueue
{
    use Queueable;

    public int $tries = 3;

    public int $timeout = 45;

    public int $uniqueFor = 3600;

    public function __construct(public readonly string $userId) {}

    public function uniqueId(): string
    {
        return $this->userId;
    }

    public function handle(MediaService $media, QrCodes $qr, MemberSessions $sessions, OgImages $og): void
    {
        $user = User::withTrashed()->find($this->userId);

        if ($user === null || ! self::isDue($user)) {
            return;
        }

        $deadline = microtime(true) + max(1, config()->integer('speedclub.account_deletion.job_seconds'));
        $limit = max(1, config()->integer('speedclub.account_deletion.media_per_job'));

        do {
            $photos = Media::withTrashed()->where('owner_id', $user->id)->orderBy('id')->limit($limit)->get();

            foreach ($photos as $photo) {
                $media->purge($photo);
            }

            if ($photos->count() === $limit && microtime(true) > $deadline) {
                // The unique lock ends when processing starts, so the next slice can queue itself.
                self::dispatch($this->userId);

                return;
            }
        } while ($photos->count() === $limit);

        $vehicles = Vehicle::withTrashed()->where('owner_id', $user->id)->get();

        foreach ($vehicles as $vehicle) {
            try {
                $og->purge($vehicle);
            } catch (Throwable $exception) {
                report($exception);
            }
        }

        try {
            $og->purge($user);
        } catch (Throwable $exception) {
            report($exception);
        }

        $exports = DataExport::query()->where('user_id', $user->id)->get();

        DB::transaction(function () use ($user, $vehicles, $qr, $sessions, $exports): void {
            foreach ($vehicles as $vehicle) {
                $qr->revoke($vehicle, QrRevocationReason::AccountDeleted);
                $vehicle->forceDelete();
            }

            $sessions->revokeAll($user);

            Audit::record(MemberSecurityEvent::HardDeleted->value, $user, after: [
                'vehicles' => $vehicles->count(),
                'exports' => $exports->count(),
            ]);

            $user->forceDelete();
        });

        foreach ($exports as $export) {
            BuildDataExport::deleteFiles($export);
        }
    }

    /**
     * Deletion asked for at least (days − 1) days ago: the daily run then completes it within the promised days.
     */
    public static function isDue(User $user): bool
    {
        $requested = $user->getAttribute('deletion_requested_at');
        $days = app(RetentionPolicy::class)->value('accounts_hard_delete_days');

        return $user->status === UserStatus::Deactivated && $requested !== null && $requested <= now()->subDays(max(0, $days - 1));
    }
}
