<?php

namespace App\Enums;

/** Audit actions of M3.6 Audit & privacy (ADM-45…47). Request texts, reply bodies and addresses never reach the row. */
enum PrivacyEvent: string
{
    case RequestCreated = 'privacy.request_created';
    case RequestAssigned = 'privacy.request_assigned';
    case RequestExtended = 'privacy.request_extended';
    case RequestStatusChanged = 'privacy.request_status_changed';
    case RequestCompleted = 'privacy.request_completed';
    case ReplySent = 'privacy.reply_sent';
    case EvidenceViewed = 'privacy.evidence_viewed';
    case ExportSent = 'privacy.export_sent';
    case ErasureRequested = 'privacy.erasure_requested';
}
