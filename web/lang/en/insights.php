<?php

// M5.7 INS-01 "Stats" (10 §6.1, m5.7-contract §3.4). Totals only, never who viewed. Fewer views are stated without a percentage and
// without judgement (10 §16: no guilt). :subject is "Your E46" or "Your garage".
return [
    'subject' => [
        'vehicle' => 'Your :title',
        'account' => 'Your garage',
    ],
    'headline' => [
        'up' => '{1} :subject was viewed once this week – :percent% more than last week.|[2,*] :subject was viewed :count times this week – :percent% more than last week.',
        'down' => '{1} :subject was viewed once this week. Last week it was :previous.|[2,*] :subject was viewed :count times this week. Last week it was :previous.',
        'plain' => '{1} :subject was viewed once this week.|[2,*] :subject was viewed :count times this week.',
        'new' => '{1} :subject got its first view this week.|[2,*] :subject got its first views this week: :count.',
        'zero' => 'No views yet this week. Share your build so more people see it.',
        'zero_account' => 'No views yet this week. Share your profile so more people see it.',
    ],
];
