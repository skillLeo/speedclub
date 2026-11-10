<?php

namespace App\Enums;

/**
 * Audit actions of M3.5 (brand, content, configuration, releases) and the member's re-consent.
 */
enum ContentEvent: string
{
    case ConfigDraftSaved = 'config.draft_saved';
    case ConfigDraftDiscarded = 'config.draft_discarded';
    case ConfigPublished = 'config.published';
    case ConfigRolledBack = 'config.rolled_back';
    case PreviewIssued = 'config.preview_issued';
    case BrandAssetUploaded = 'brand.asset_uploaded';
    case LegalDraftSaved = 'legal.draft_saved';
    case LegalDraftDiscarded = 'legal.draft_discarded';
    case LegalPublished = 'legal.published';
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
