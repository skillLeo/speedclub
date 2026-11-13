<?php

namespace App\Policies;

/**
 * The parts catalogue (09 §8.9): everyone reads it, guests included; staff change it in ADM-57 (admin permissions).
 */
class ProductPolicy extends PublicReadPolicy {}
