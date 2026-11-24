<?php

namespace App\Console\Commands;

use App\Services\Ai\ForumSummaries;
use Illuminate\Console\Attributes\Description;
use Illuminate\Console\Attributes\Signature;
use Illuminate\Console\Command;

#[Signature('forum:summaries')]
#[Description('M5.9: the 3-line KI-Zusammenfassung of forum threads with more than 20 replies; drops stale ones (≤ 40 s, resumable)')]
class SummariseForumThreadsCommand extends Command
{
    public function handle(ForumSummaries $summaries): int
    {
        $written = $summaries->run();
        $this->info($written === null ? 'Another run is still summarising.' : "Wrote $written summaries.");

        return self::SUCCESS;
    }
}
