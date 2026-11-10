<?php

namespace App\Support\Queue;

use DateTimeInterface;
use Illuminate\Queue\Failed\CountableFailedJobProvider;
use Illuminate\Queue\Failed\FailedJobProviderInterface;
use Illuminate\Queue\Failed\PrunableFailedJobProvider;
use Throwable;

/**
 * Wraps the failed-job store so that failed_jobs.exception never holds a message (BL-2): it gets ScrubbedException's summary instead
 * of the exception's text and trace with arguments. Everything else goes to the wrapped provider unchanged.
 */
final class ScrubbingFailedJobProvider implements CountableFailedJobProvider, FailedJobProviderInterface, PrunableFailedJobProvider
{
    public function __construct(private readonly FailedJobProviderInterface $inner) {}

    /**
     * @param  string  $connection
     * @param  string  $queue
     * @param  string  $payload
     * @param  Throwable  $exception
     * @return string|int|null
     */
    public function log($connection, $queue, $payload, $exception)
    {
        return $this->inner->log($connection, $queue, $payload, new ScrubbedException($exception));
    }

    public function ids($queue = null)
    {
        return $this->inner->ids($queue);
    }

    public function all()
    {
        return $this->inner->all();
    }

    public function find($id)
    {
        return $this->inner->find($id);
    }

    public function forget($id)
    {
        return $this->inner->forget($id);
    }

    public function flush($hours = null)
    {
        $this->inner->flush($hours);
    }

    /**
     * @param  string|null  $connection
     * @param  string|null  $queue
     */
    public function count($connection = null, $queue = null)
    {
        return $this->inner instanceof CountableFailedJobProvider ? $this->inner->count($connection, $queue) : count($this->inner->all());
    }

    public function prune(DateTimeInterface $before)
    {
        return $this->inner instanceof PrunableFailedJobProvider ? $this->inner->prune($before) : 0;
    }
}
