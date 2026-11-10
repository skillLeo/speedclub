<?php

namespace App\Support\Cache;

use Illuminate\Cache\DatabaseStore;
use Illuminate\Cache\RateLimiter;

/**
 * The framework's rate limiter, without the step that loses hits on the database store (ADR draft "rate limiter
 * deadlocks", 2026-11-06).
 *
 * RateLimiter::increment() ends with "if (! $added && $hits == $amount) put($key, $amount)". That is for stores whose
 * increment creates a missing key without an expiry (Redis INCR, the array store). DatabaseStore::increment() never
 * creates a row, so on it the condition only holds in a race: another request added the row and has not counted
 * yet, this one counted first, and its put() then overwrote every hit counted in between. Measured: 8 processes ×
 * 3 hits on a fresh key ended at 17 instead of 24. 02_PRODUCT_SPEC §8 needs every hit counted.
 */
class LosslessRateLimiter extends RateLimiter
{
    /** The same cache and the named limiters already registered on $limiter. */
    public static function from(RateLimiter $limiter): self
    {
        $lossless = new self($limiter->cache);
        $lossless->limiters = $limiter->limiters;

        return $lossless;
    }

    /**
     * @param  string  $key
     * @param  \DateTimeInterface|\DateInterval|int  $decaySeconds
     * @param  int  $amount
     * @return int
     */
    public function increment($key, $decaySeconds = 60, $amount = 1)
    {
        if (! $this->cache->getStore() instanceof DatabaseStore) {
            return parent::increment($key, $decaySeconds, $amount);
        }

        $key = $this->cleanRateLimiterKey($key);

        $this->cache->add($key.':timer', $this->availableAt($decaySeconds), $decaySeconds);

        // increment() answers false only when the row is gone: expired or reset since add(). Add it again.
        for ($attempt = 1; $attempt <= 3; $attempt++) {
            $this->cache->add($key, 0, $decaySeconds);

            $hits = $this->cache->increment($key, $amount);

            if ($hits !== false) {
                return (int) $hits;
            }
        }

        $this->cache->put($key, $amount, $decaySeconds);

        return $amount;
    }
}
