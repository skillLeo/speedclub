<?php

// M2.6: moderation decisions in e-mails (statement of reasons, Art. 17 DSA) and the outcome for notifiers (Art. 16(5) DSA). The app
// renders SAFE-01 and SET-16 itself from the API's keys. Facts and ground are the decider's own words and are not translated.
return [
    'target' => [
        'member' => 'your profile :label',
        'vehicle' => 'your build :label',
        'photo' => 'a photo of your build :label',
        'message' => 'a message you sent',
        'build_update' => 'an update to your build :label',
        'modification' => 'a modification on your build :label',
        'comment' => 'a comment you wrote',
        'event' => 'your meet “:label”',
        'business' => 'your business profile “:label”',
    ],
    'target_unnamed' => [
        'member' => 'your profile',
        'vehicle' => 'one of your builds',
        'photo' => 'one of your photos',
        'message' => 'a message you sent',
        'build_update' => 'one of your updates',
        'modification' => 'one of your modifications',
        'comment' => 'a comment you wrote',
        'event' => 'one of your meets',
        'business' => 'your business profile',
    ],

    'outcome' => [
        'no_action' => 'Decision: we took no action.',
        'remove_content' => 'Decision: we removed the content. Others can no longer see it.',
        'remove_profile' => 'Decision: we removed your display name, your short bio and your profile and cover pictures. Your username and builds remain.',
        'restrict_messaging' => 'Decision: you cannot send messages for now.',
        'restrict_messaging_until' => 'Decision: you cannot send messages until :date.',
        'restrict_publishing' => 'Decision: you cannot publish or edit anything for now.',
        'restrict_publishing_until' => 'Decision: you cannot publish or edit anything until :date.',
        'suspend' => 'Decision: we suspended your account.',
        'suspend_until' => 'Decision: we suspended your account until :date.',
        // M3.2: a reverse decision.
        'reverse' => 'Decision: we lifted an earlier measure.',
    ],
    'reporter_outcome' => [
        'no_action' => 'We reviewed the reported content and found no violation. It stays online.',
        'remove_content' => 'We removed the reported content.',
        'measures' => 'We took action against the account concerned.',
        'reversed' => 'We lifted an earlier measure.',
    ],

    // Art. 17(3)(a) DSA: what the decision applies to and for how long.
    'scope' => [
        'content' => 'Scope and duration: we removed the content across SPEED CLUB, and nobody else can see it anywhere. This is permanent unless an appeal succeeds.',
        'account_until' => 'Scope and duration: the measure applies to your account until :date and then ends automatically.',
        'account' => 'Scope and duration: the measure applies to your account and has no end date. It ends if an appeal succeeds or we lift it.',
    ],

    'mail' => [
        'decision' => [
            'subject' => 'Our decision on a report',
            'heading' => 'We made a decision',
            'intro' => 'We reviewed a report about :target.',
            // M3.2: an own-initiative case (staff acted without a report).
            'subject_own' => 'Our decision about your account or content',
            'intro_own' => 'Our team reviewed :target on its own initiative, without a report.',
            'detection_own' => 'Detection: our team noticed this without a report; automated means did not detect it.',
            'facts' => 'Facts: :facts',
            'ground' => 'Ground: :ground',
            'detection_no' => 'Detection: the content was reported to us; automated means did not detect it.',
            'detection_yes' => 'Detection: the content was detected by automated means.',
            'decision_no' => 'Review: a person on our team made the decision. It was not taken by automated means.',
            'decision_yes' => 'Review: the decision was taken by automated means.',
            'redress' => [
                'internal_complaint' => 'Appeal: you can appeal until :date. Another member of our team will then review the decision again.',
                'internal_complaint_no_date' => 'Appeal: you can appeal within :months months of this message. Another member of our team will then review the decision again.',
                'out_of_court' => "Out-of-court dispute settlement: you can turn to a certified out-of-court dispute settlement body under Art.\u{00A0}21 of the Digital Services Act (DSA). You can find a list of these bodies at :url",
                'court' => 'Court: you can also have the decision reviewed by a court.',
            ],
            'action' => 'View decision',
            'note' => 'You can appeal by :date in the app (Settings › Reports & decisions) or by writing to :support. Please quote the number :reference.',
            'note_no_date' => 'You can appeal within :months months of this message in the app (Settings › Reports & decisions) or by writing to :support. Please quote the number :reference.',
            'note_suspended' => 'While your account is suspended, you cannot sign in. Send your appeal to :support by :date and quote the number :reference.',
            'note_suspended_no_date' => 'While your account is suspended, you cannot sign in. Send your appeal to :support within :months months of this message and quote the number :reference.',
        ],
        // M3.2: a reverse decision lifted a measure (staff, or an upheld appeal). No redress: nothing is held against the member.
        'reversed' => [
            'subject' => 'We lifted a measure',
            'heading' => 'The measure has been lifted',
            'intro' => 'We lifted our decision of :date about :target.',
            'lifted' => [
                'restrict_messaging' => 'You can send messages again.',
                'restrict_publishing' => 'You can publish and edit again.',
                'suspend' => 'Your account is no longer suspended. You can sign in again.',
                'remove_content' => 'The content is back, and others see it as before.',
                'remove_profile' => 'Your display name, short bio and profile and cover pictures are back, unless you have set new ones since.',
            ],
            'facts' => 'Reason: :facts',
            'action' => 'View decision',
            'note' => 'Questions? Write to :support and quote the number :reference.',
        ],
        'received' => [
            'subject' => 'We received your report',
            'heading' => 'Thanks for your report',
            'intro' => 'You reported this page to us: :url (reason: :reason).',
            'next' => 'We will review the report and write to this address once we have decided.',
            'reference' => 'Your report number: :reference',
            'note' => 'You did not send this report? Then you can ignore this e-mail.',
        ],
        'outcome' => [
            'subject' => 'Our decision on your report',
            'heading' => 'We reviewed your report',
            'intro' => 'You reported content to us (report number :reference).',
            'redress_no_date' => "Disagree with the decision? Write to :support within :months months of this message and quote the report number. Another member of our team will then review the decision again. You can also turn to a certified out-of-court dispute settlement body under Art.\u{00A0}21 of the Digital Services Act (DSA) (list: :url) or have the decision reviewed by a court.",
            'redress' => "Disagree with the decision? Write to :support by :date and quote the report number. Another member of our team will then review the decision again. You can also turn to a certified out-of-court dispute settlement body under Art.\u{00A0}21 of the Digital Services Act (DSA) (list: :url) or have the decision reviewed by a court.",
            'note' => 'Thanks for helping keep SPEED CLUB safe.',
            'note_no_action' => 'Thanks for letting us know. Even though we did not remove anything this time, every report helps us.',
        ],
        // M3.4: the outcome of an internal complaint (Art. 20(4) DSA), to the person who appealed.
        'appeal' => [
            'subject' => 'We reviewed your appeal',
            'heading' => 'Your appeal has been decided',
            'intro' => 'You appealed against our decision :reference. A different member of our team than for the first decision reviewed it.',
            'upheld' => 'Outcome: the decision stands.',
            'reversed' => 'Outcome: we changed the decision. What changes is shown in the decision in the app.',
            'explanation' => 'Reason: :text',
            'redress' => "You can still turn to a certified out-of-court dispute settlement body under Art.\u{00A0}21 of the Digital Services Act (DSA) (list: :url) or have the decision reviewed by a court.",
            'action' => 'View decision',
        ],
        // M3.4: a reply of the team to a WEB-10 contact message (members read replies in the app).
        'support_reply' => [
            'subject' => 'Reply to your request :reference',
            'heading' => 'We replied to you',
            'intro' => 'Here is our reply to your request :reference:',
            'note' => 'Just reply to this e-mail or write to us through the contact form and quote the number :reference.',
        ],
    ],

    // M3.2: the moderator's limit on suspensions (06_ADMIN_SPEC §2), shown in the admin.
    'suspension_limit' => 'With the Moderation role you can suspend for :days days at most, that is until :date.',

    'command' => [
        'decided' => 'Decided: :action (decision :id).',
        'not_open' => 'This case is not open.',
        'not_found' => 'There is no such case.',
        'invalid' => 'The input is invalid: :message',
    ],
];
