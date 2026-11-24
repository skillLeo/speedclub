<?php

namespace App\Policies;

/**
 * M5.8 forum categories: structure everybody reads, guests included (inactive ones are left out by ForumCategories::open and the tree).
 * Changes are staff only, through ADM Forum › Kategorien (moderation.rules), so members have no create, update or delete ability here.
 */
class ForumCategoryPolicy extends PublicReadPolicy {}
