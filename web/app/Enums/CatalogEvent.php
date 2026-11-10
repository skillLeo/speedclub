<?php

namespace App\Enums;

/**
 * Audit actions of the catalogue admin (M3.3, ADM-14…17). The actor is the staff member; a four-eyes action names requester and approver
 * in `after`. `catalog.merged` carries the affected vehicles as `records` (the rolling 100-record window of ADR-229 reads it).
 */
enum CatalogEvent: string
{
    case Created = 'catalog.created';
    case Updated = 'catalog.updated';
    case Deactivated = 'catalog.deactivated';
    case Activated = 'catalog.activated';
    case Deleted = 'catalog.deleted';
    case Merged = 'catalog.merged';
    case RequestAccepted = 'catalog.request_accepted';
    case RequestRejected = 'catalog.request_rejected';
    case CategoryCreated = 'catalog.category_created';
    case CategoryUpdated = 'catalog.category_updated';
    case SchemaChanged = 'catalog.schema_changed';
    case ImportAnalysed = 'catalog.import_analysed';
    case ImportStarted = 'catalog.import_started';
    case ImportFinished = 'catalog.import_finished';
    case Exported = 'catalog.exported';
}
