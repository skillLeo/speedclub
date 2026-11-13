<?php

// Labels for App\Enums, one group per enum (App\Support\Enums\HasLabel).
return [
    'power_unit' => [
        'ps' => 'PS',
        'kw' => 'kW',
        'hp' => 'hp',
    ],
    'power_source' => [
        'factory' => 'Manufacturer',
        'claimed' => 'Estimated',
        'measured' => 'Dyno',
    ],
    'vehicle_status' => [
        'draft' => 'Draft',
        'published' => 'Published',
        'archived' => 'Archived',
    ],
    'visibility' => [
        'public' => 'Public',
        'unlisted' => 'Unlisted',
        'private' => 'Private',
    ],
    'mod_status' => [
        'installed' => 'Installed',
        'planned' => 'Planned',
        'removed' => 'Removed',
    ],
    'legal_status' => [
        'abe' => 'ABE',
        'parts_certificate' => 'Parts certificate',
        'registered' => 'Registered',
        'individual_approval' => 'Individual approval',
        'not_required' => 'Approval-free',
        'unknown' => 'Unknown',
    ],
    'media_category' => [
        'exterior' => 'Exterior',
        'interior' => 'Interior',
        'engine' => 'Engine',
        'wheels' => 'Wheels',
        'detail' => 'Details',
        'other' => 'Other',
    ],
    'media_status' => [
        'processing' => 'Processing',
        'ready' => 'Ready',
        'failed' => 'Failed',
    ],
    'moderation_status' => [
        'pending' => 'Pending',
        'approved' => 'Approved',
        'flagged' => 'Flagged',
        'rejected' => 'Rejected',
    ],
    'qr_status' => [
        'active' => 'Active',
        'revoked' => 'Revoked',
    ],
    'qr_revocation_reason' => [
        'reissued' => 'Reissued',
        'vehicle_deleted' => 'Vehicle deleted',
        'account_deleted' => 'Account deleted',
        'moderation' => 'Moderation',
    ],
    'fuel' => [
        'petrol' => 'Petrol',
        'diesel' => 'Diesel',
        'hybrid' => 'Hybrid',
        'plug_in_hybrid' => 'Plug-in hybrid',
        'electric' => 'Electric',
        'lpg' => 'LPG',
        'cng' => 'CNG',
        'ethanol' => 'Ethanol (E85)',
        'other' => 'Other',
    ],
    'aspiration' => [
        'naturally_aspirated' => 'Naturally aspirated',
        'turbo' => 'Turbo',
        'biturbo' => 'Twin turbo',
        'supercharged' => 'Supercharged', // design-lint-disable-line DL09 -- engine aspiration term (Aufladung), not marketing copy
        'twincharged' => 'Twincharged',
        'none' => 'None (electric)',
    ],
    'drivetrain' => [
        'front' => 'Front-wheel drive',
        'rear' => 'Rear-wheel drive',
        'all' => 'All-wheel drive',
    ],
    'gearbox' => [
        'manual' => 'Manual',
        'automatic' => 'Automatic',
        'dual_clutch' => 'Dual clutch',
        'sequential' => 'Sequential',
        'cvt' => 'CVT',
        'single_speed' => 'Single speed',
    ],
    'user_status' => [
        'active' => 'Active',
        'suspended' => 'Suspended',
        'deactivated' => 'Deactivated',
    ],
    'restriction_type' => [
        'messaging' => 'Messaging',
        'publishing' => 'Publishing',
    ],
    'verification_purpose' => [
        'email_verification' => 'Verify email',
        'password_reset' => 'Reset password',
        'email_change' => 'Change email',
    ],
    'theme_preference' => [
        'carbon' => 'Carbon',
        'black' => 'Black',
        'light' => 'Light',
        'system' => 'System',
    ],
    'power_display' => [
        'ps_kw' => 'PS (kW)',
        'kw_ps' => 'kW (PS)',
        'hp' => 'hp',
    ],
    'who_can_message' => [
        'everyone' => 'Everyone',
        'following' => 'Members I follow',
        'nobody' => 'Nobody',
    ],
    'build_update_type' => [
        'mod_added' => 'Modification added',
        'mod_changed' => 'Modification changed',
        'mod_removed' => 'Modification removed',
        'specs_changed' => 'Specs changed',
        'photos_added' => 'New photos',
        'note' => 'Note',
        'post' => 'Update',
    ],
    'social_provider' => [
        'apple' => 'Apple',
        'google' => 'Google',
    ],
    'device_platform' => [
        'ios' => 'iOS',
        'android' => 'Android',
        'web' => 'Web',
    ],
    'catalog_request_status' => [
        'pending' => 'Pending',
        'approved' => 'Approved',
        'rejected' => 'Rejected',
    ],
    'mod_field_type' => [
        'text' => 'Text',
        'number' => 'Number',
        'boolean' => 'Yes/No',
        'select' => 'Select',
        'brand' => 'Brand',
    ],
    'config_version_status' => [
        'draft' => 'Draft',
        'published' => 'Published',
        'superseded' => 'Superseded',
    ],
    'legal_document_key' => [
        'imprint' => 'Legal notice',
        'privacy' => 'Privacy policy',
        'terms' => 'Terms of use',
        'community' => 'Community guidelines',
        'licenses' => 'Licences',
    ],
    'audit_actor_type' => [
        'staff' => 'Staff',
        'member' => 'Member',
        'system' => 'System',
    ],
    'cannot_message_reason' => [
        'recipient_closed' => 'This member is not taking messages from you right now.',
        'not_verified' => 'Confirm your e-mail address first, then you can write.',
        'restricted' => 'Your account is restricted from messaging right now.',
    ],
    // M2.5 settings, data rights and support.
    'data_export_status' => [
        'queued' => 'Requested',
        'running' => 'Being created',
        'ready' => 'Ready',
        'failed' => 'Failed',
        'expired' => 'Expired',
    ],
    'support_category' => [
        'account' => 'Account and sign-in',
        'vehicle' => 'Vehicles and garage',
        'qr' => 'QR stickers',
        'messaging' => 'Messages',
        'safety' => 'Safety and reports',
        'other' => 'Other',
    ],
    'support_ticket_status' => [
        'open' => 'Open',
        'pending' => 'Waiting for reply',
        'closed' => 'Done',
    ],
    'support_ticket_source' => [
        'app' => 'App',
        'web' => 'Contact form',
    ],
    'ticket_author_type' => [
        'member' => 'Member',
        'guest' => 'Guest',
        'staff' => 'Team',
    ],
    'session_kind' => [
        'app' => 'App',
        'web' => 'Browser',
    ],
    'reaction_type' => [
        'strong' => 'Strong',
        'clean' => 'Clean',
        'low' => 'Low',
        'loud' => 'Loud',
    ],
    'build_update_audience' => [
        'vehicle' => 'Like the vehicle',
        'followers' => 'Followers only',
    ],
    'comment_status' => [
        'visible' => 'Visible',
        'removed' => 'Removed',
    ],
    'mention_privacy' => [
        'everyone' => 'Everyone',
        'followers' => 'Followers',
        'nobody' => 'Nobody',
    ],
    'event_type' => [
        'meet' => 'Meet',
        'cruise' => 'Cruise',
        'track_day' => 'Track day',
        'show' => 'Show',
    ],
    'event_status' => [
        'draft' => 'Draft',
        'pending_review' => 'In review',
        'published' => 'Published',
        'cancelled' => 'Cancelled',
        'rejected' => 'Rejected',
    ],
    'event_visibility' => [
        'public' => 'Public',
        'followers' => 'Followers only',
        'unlisted' => 'Link only',
    ],
    'event_location_visibility' => [
        'public' => 'Public',
        'after_rsvp' => 'After RSVP',
    ],
    'rsvp_status' => [
        'going' => 'Going',
        'interested' => 'Interested',
        'waitlist' => 'Waitlist',
    ],
    'event_rule' => [
        'legal_only' => 'Legal only: no racing, no dangerous driving on public roads',
        'no_racing' => 'No burnouts, no drifting, no racing',
        'respect_residents' => 'Respect residents: engines off, no loud music',
        'no_litter' => 'Leave no rubbish behind',
        'permits_arranged' => 'Permits and the venue owner\'s consent are in place',
    ],
    // M4.13 Garage pro (09 §8.8, §8.11).
    'maintenance_type' => [
        'hu_au' => 'MOT (HU/AU)',
        'service' => 'Service',
        'oil_change' => 'Oil change',
        'brake_fluid' => 'Brake fluid',
        'tyre_change' => 'Tyre change',
        'insurance' => 'Car insurance',
        'custom' => 'Custom',
    ],
    'maintenance_due_state' => [
        'unknown' => 'No date',
        'ok' => 'OK',
        'soon' => 'Due soon',
        'overdue' => 'Overdue',
    ],
    'distance_unit' => [
        'km' => 'km',
        'mi' => 'mi',
    ],
    'torque_unit' => [
        'nm' => 'Nm',
        'lbft' => 'lb-ft',
    ],
    'weight_unit' => [
        'kg' => 'kg',
        'lb' => 'lb',
    ],
];
