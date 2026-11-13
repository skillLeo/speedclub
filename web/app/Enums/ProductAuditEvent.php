<?php

namespace App\Enums;

/**
 * Staff changes to the parts catalogue (ADM-57, 09 §8.9), each written with Audit::record and labelled in lang/admin/{de,en}/audit.json.
 * A merge carries the number of re-linked mods.
 */
enum ProductAuditEvent: string
{
    case Created = 'product.created';
    case Updated = 'product.updated';
    case Archived = 'product.archived';
    case Restored = 'product.restored';
    case Merged = 'product.merged';
}
