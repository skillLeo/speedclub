<?php

namespace App\Enums;

/** Audit actions of M3.6 System (ADM-48…50). Job payloads, addresses and provider answers never reach the row. */
enum SystemEvent: string
{
    case HealthChecksRun = 'system.health_checks_run';
    case JobsRetried = 'system.jobs_retried';
    case JobsForgotten = 'system.jobs_forgotten';
    case TestMailSent = 'system.test_mail_sent';
    case TestPusherSent = 'system.test_pusher_sent';
    case TestAiRun = 'system.test_ai_run';
}
