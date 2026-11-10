<?php

namespace App\Console\Commands;

use Illuminate\Console\Attributes\Description;
use Illuminate\Console\Attributes\Signature;
use Illuminate\Console\Command;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use RuntimeException;

#[Signature('audit:export {--date= : Day to export, Y-m-d; defaults to yesterday}')]
#[Description('Write one day of the audit log as JSONL to private storage')]
class AuditExportCommand extends Command
{
    public function handle(): int
    {
        $option = $this->option('date');
        $day = is_string($option) ? Carbon::parse($option, 'UTC')->startOfDay() : Carbon::yesterday('UTC');
        $path = 'audit/'.$day->format('Y-m-d').'.jsonl';

        $stream = fopen('php://temp', 'w+b');

        if ($stream === false) {
            throw new RuntimeException('Could not open a temporary stream.');
        }

        $count = 0;
        $rows = DB::table('audit_events')
            ->where('occurred_at', '>=', $day->format('Y-m-d H:i:s'))
            ->where('occurred_at', '<', $day->copy()->addDay()->format('Y-m-d H:i:s'))
            ->orderBy('id')
            ->lazyById(1000);

        foreach ($rows as $row) {
            fwrite($stream, json_encode($row, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)."\n");
            $count++;
        }

        rewind($stream);
        $written = Storage::disk(config()->string('speedclub.media.private_disk'))->put($path, $stream);
        fclose($stream);

        if ($written === false) {
            $this->error("Could not write $path.");

            return self::FAILURE;
        }

        $this->info("Exported $count events to $path.");

        return self::SUCCESS;
    }
}
