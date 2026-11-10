<?php

namespace App\Services\Approvals;

use Symfony\Component\HttpKernel\Exception\ConflictHttpException;

/**
 * The request is no longer pending (decided, cancelled or expired by someone else first). Renders as 409.
 */
final class ApprovalConflict extends ConflictHttpException {}
