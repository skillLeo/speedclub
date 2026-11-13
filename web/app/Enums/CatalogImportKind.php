<?php

namespace App\Enums;

/**
 * ADM-17: what a CSV import holds. `vehicles`: makes, models and generations, one row per entry of the deepest level named. `brands`:
 * part brands with category hint and aliases. `products` (M4.14, ADM-57): products of the parts catalogue, one row per brand + product name.
 * Labels live with the admin page (lang/admin/<locale>/catalog.json).
 */
enum CatalogImportKind: string
{
    case Vehicles = 'vehicles';
    case Brands = 'brands';
    case Products = 'products';
}
