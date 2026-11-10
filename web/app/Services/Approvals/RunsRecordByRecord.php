<?php

namespace App\Services\Approvals;

/**
 * A handler whose execution touches many records, each in its own short transaction with its own audit event (the member and vehicle
 * bulk actions, SF-3 / SEC-P3-09). Approvals::approve() records the approval first (status executing, under the row lock: one winner),
 * commits, and only then runs execute(), so no outer transaction holds the audit chain head for the whole run, and one record that
 * fails undoes nothing of the others.
 */
interface RunsRecordByRecord {}
