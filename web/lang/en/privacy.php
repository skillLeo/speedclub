<?php

// M3.6 Audit & privacy (ADM-45…47): request types, template replies (EN) and validation texts.
return [
    'types' => [
        'access' => 'access',
        'export' => 'data portability',
        'erasure' => 'erasure',
        'rectification' => 'rectification',
        'objection' => 'objection',
        'restriction' => 'restriction of processing',
    ],
    'validation' => [
        'assignee' => 'Choose an active team member who may process privacy requests.',
        'final_via_complete' => 'To close or reject, use “Complete” with evidence.',
        'outcome' => 'Choose “completed” or “rejected”.',
    ],
    'retention' => [
        'unknown' => 'These periods do not exist: :keys.',
    ],
    'reply' => [
        'note' => 'Reference :reference. If you have questions, reach us at :support.',
        'received' => [
            'subject' => 'We received your privacy request :reference',
            'heading' => 'We received your request',
            'body' => 'Your request for :type (Art. :article GDPR) has reached us. We will answer by :date at the latest.',
        ],
        'identity' => [
            'subject' => 'Your privacy request :reference: we need more details',
            'heading' => 'Please confirm that the request comes from you',
            'body' => 'So that we do not give data to the wrong person, we need proof. The easiest way is to write to us from the email address of your SPEED CLUB account. The deadline runs until :date.',
        ],
        'extension' => [
            'subject' => 'Your privacy request :reference: we need more time',
            'heading' => 'We are extending the deadline',
            'body' => 'Your request for :type needs more time. Under Art. 12(3) GDPR we extend the deadline until :date. The reason:',
        ],
        'completed' => [
            'subject' => 'Your privacy request :reference is done',
            'heading' => 'Your request is done',
            'body' => 'We have processed your request for :type (Art. :article GDPR).',
        ],
        'rejected' => [
            'subject' => 'Your privacy request :reference',
            'heading' => 'We cannot comply with your request',
            'body' => 'We cannot, or cannot fully, comply with your request for :type. You may lodge a complaint with a data protection supervisory authority or seek a judicial remedy (Art. 12(4) GDPR). The reasons:',
        ],
    ],
];
