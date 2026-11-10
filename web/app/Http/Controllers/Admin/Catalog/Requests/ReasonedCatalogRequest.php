<?php

namespace App\Http\Controllers\Admin\Catalog\Requests;

/**
 * An ADM-14…16 write with a required reason and nothing else (`catalog.manage`): delete, field archive/delete, request reject.
 */
class ReasonedCatalogRequest extends CatalogFormRequest {}
