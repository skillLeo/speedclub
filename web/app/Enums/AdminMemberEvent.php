<?php

namespace App\Enums;

/**
 * Audit actions of staff actions in the member, vehicle, media and QR admin (M3.2, 06_ADMIN_SPEC §1: everything is audited, sensitive
 * views too). The actor is always the staff member; a four-eyes action names requester and approver in `after`. Restrictions,
 * suspensions, hiding and their reversal are decisions and audit as `moderation.decided` (DecideCase).
 */
enum AdminMemberEvent: string
{
    case PiiViewed = 'member.pii_viewed';
    case ListExported = 'member.list_exported';
    case MessageMetadataViewed = 'member.message_metadata_viewed';
    case ViewAsStarted = 'member.view_as_started';
    case ViewAsEnded = 'member.view_as_ended';
    case ProfileEdited = 'member.profile_edited';
    case EmailChangedByStaff = 'member.email_changed_by_staff';
    case ResetLinkSent = 'member.reset_link_sent';
    case PasswordChangeForced = 'member.password_change_forced';
    case SessionsRevokedByStaff = 'member.sessions_revoked_by_staff';
    case TwoFactorReset = 'member.two_factor_reset';
    case ExportRequested = 'member.export_started';
    case ExportDownloaded = 'member.export_downloaded';
    case DeletedByStaff = 'member.deleted_by_staff';
    case BulkExecuted = 'member.bulk_executed';
    case VehicleEdited = 'vehicle.edited_by_staff';
    case VehicleDeleted = 'vehicle.deleted_by_staff';
    case VehicleBulkHidden = 'vehicle.bulk_hidden';
    case MediaReviewed = 'media.reviewed';
    case QrRevoked = 'qr.revoked_by_staff';
    case QrReissued = 'qr.reissued_by_staff';
}
