<?php

namespace App\Console\Commands;

use App\Models\User;
use App\Services\Wrapped\Season;
use App\Services\Wrapped\WrappedGenerator;
use App\Services\Wrapped\WrappedReleases;
use Illuminate\Console\Attributes\Description;
use Illuminate\Console\Attributes\Signature;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Log;

#[Signature('speedclub:wrapped:generate {season : 2027-saison, 2027-jahr, or "due" for every season released within wrapped.generate_days_before days} {--user= : one member (username or id), now} {--restart : start the pass of this release over}')]
#[Description('Season Wrapped: generate the members\' payloads in resumable, ≤ 50 s passes (m5.9e §2)')]
class GenerateWrappedCommand extends Command
{
    public function handle(WrappedGenerator $generator, WrappedReleases $releases): int
    {
        $argument = (string) $this->argument('season');
        $seasons = $argument === 'due' ? $releases->due() : [$argument];
        $status = self::SUCCESS;

        foreach ($seasons as $key) {
            $season = Season::tryFrom($key);

            if ($season === null) {
                $this->error("Unknown season [$key]: use YYYY-saison, YYYY-jahr or due.");

                return self::FAILURE;
            }

            // CR-P5G-16: --user with "due" handles every due season, not only the first.
            if ($this->option('user') !== null) {
                $status = max($status, $this->one($generator, $season, (string) $this->option('user')));

                continue;
            }

            // CR-P5G-05: one pass per season and release, so an unfinished pass continues on the next day instead of starting over.
            $release = $releases->releaseAt($season->key);
            $runKey = WrappedGenerator::runKey($release);

            if ($this->option('restart') === true) {
                $generator->restart($season, $runKey);
            }

            // One budgeted pass inline (the scheduler or the cron URL calls again until done); the queued job is for on-demand runs.
            $result = $generator->run($season, $runKey);

            $this->info($result === null
                ? "{$season->key}: another run is still working."
                : "{$season->key}: ".($result['done'] ? 'done' : 'continues with the next run')."; members {$result['members']}, written {$result['written']}.");

            if ($release !== null && $release->lessThanOrEqualTo(now()) && ! WrappedGenerator::passCompleted($season, $runKey)) {
                Log::warning('Wrapped is released but its generation pass is not done yet: members without a Wrapped read 404 until it is.', [
                    'season' => $season->key,
                    'release_at' => $release->toIso8601String(),
                ]);
            }
        }

        if ($seasons === []) {
            $this->info('No season is due.');
        }

        return $status;
    }

    private function one(WrappedGenerator $generator, Season $season, string $who): int
    {
        $member = User::query()->where('username', $who)->orWhere('id', strtolower($who))->first();

        if (! $member instanceof User) {
            $this->error("No member [$who].");

            return self::FAILURE;
        }

        $wrapped = $generator->generate($member, $season);
        $this->info($wrapped === null
            ? "{$season->key}: nothing to show for @{$member->username}."
            : "{$season->key}: @{$member->username} has ".count($wrapped->cards()).' cards.');

        return self::SUCCESS;
    }
}
