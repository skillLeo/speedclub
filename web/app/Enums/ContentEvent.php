<?php

namespace App\Enums;

/**
 * Audit actions of M3.5 (brand, content, configuration, releases) and the member's re-consent.
 */
enum ContentEvent: string
{
    case ConfigDraftSaved = 'config.draft_saved';
    case ConfigDraftDiscarded = 'config.draft_discarded';
    /** M5.1: someone with the key's publish atom took over another staff member's draft (reason), so it can be finished. */
    case ConfigDraftTakenOver = 'config.draft_taken_over';
    case ConfigPublished = 'config.published';
    case ConfigRolledBack = 'config.rolled_back';
    case PreviewIssued = 'config.preview_issued';
    case BrandAssetUploaded = 'brand.asset_uploaded';
    case LegalDraftSaved = 'legal.draft_saved';
    case LegalDraftDiscarded = 'legal.draft_discarded';
    case LegalPublished = 'legal.published';
    /** DQ-P5-103: the system replaced a published version's reason that named internal tracker IDs with plain words (data migration). */
    case LegalReasonReworded = 'legal.reason_reworded';
    case HelpSaved = 'help.saved';
    case HelpPublished = 'help.published';
    case HelpUnpublished = 'help.unpublished';
    case HelpDeleted = 'help.deleted';
    case TemplateSaved = 'template.saved';
    case TemplateReset = 'template.reset';
    case TemplateTestSent = 'template.test_sent';
    case FlagChanged = 'flag.changed';
    case ReleaseRecorded = 'release.recorded';
    case ReleaseUpdated = 'release.updated';
    case ReleasesSynced = 'release.synced';
    case ConsentAccepted = 'member.consent_accepted';
}
