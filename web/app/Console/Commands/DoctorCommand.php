<?php

namespace App\Console\Commands;

use App\Enums\DoctorLevel;
use App\Support\Doctor\DoctorResult;
use App\Support\Doctor\EnvironmentDoctor;
use Illuminate\Console\Command;

class DoctorCommand extends Command
{
    protected $signature = 'speedclub:doctor';

    protected $description = 'Check that this host can run SPEED CLUB (exit 1 only on blockers)';

    public function handle(EnvironmentDoctor $doctor): int
    {
        $results = $doctor->run();

        $this->table(
            ['Status', 'Check', 'Detail'],
            array_map(fn (DoctorResult $result): array => [
                $this->label($result->level),
                $result->check,
                $result->detail,
            ], $results),
        );

        $blockers = $this->countLevel($results, DoctorLevel::Blocker);
        $warnings = $this->countLevel($results, DoctorLevel::Warning);

        if ($blockers > 0) {
            $this->error("{$blockers} blocker(s), {$warnings} warning(s). Fix the blockers before going live.");

            return self::FAILURE;
        }

        $this->info("No blockers, {$warnings} warning(s).");

        return self::SUCCESS;
    }

    /**
     * @param  list<DoctorResult>  $results
     */
    private function countLevel(array $results, DoctorLevel $level): int
    {
        return count(array_filter($results, fn (DoctorResult $result): bool => $result->level === $level));
    }

    private function label(DoctorLevel $level): string
    {
        return match ($level) {
            DoctorLevel::Ok => '<info>OK</info>',
            DoctorLevel::Warning => '<comment>WARN</comment>',
            DoctorLevel::Blocker => '<error>BLOCKER</error>',
        };
    }
}
