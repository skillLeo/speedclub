<?php

namespace App\Exceptions;

use App\Models\User;
use RuntimeException;

/**
 * WEB-05 by e-mail code: the second factor is missing, wrong or locked. Thrown inside EmailCodes::consume, so the e-mail code stays unused
 * and its row unchanged; the failure is counted after the rollback (ProveDeletionByEmailCode).
 */
final class SecondFactorRefused extends RuntimeException
{
    public const LOCKED = 'locked';

    public const REQUIRED = 'required';

    public const WRONG = 'wrong';

    public function __construct(public readonly User $user, public readonly string $reason)
    {
        parent::__construct('The second factor was refused: '.$reason.'.');
    }
}
