<?php

namespace App\Policies;

/**
 * Internal to the idempotency middleware: no member ability, so every check is denied.
 */
class IdempotencyKeyPolicy {}
