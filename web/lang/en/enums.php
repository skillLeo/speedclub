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
    'mod_priority' => [
        'low' => 'Low',
        'normal' => 'Normal',
        'high' => 'High',
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
        'event' => 'Event gallery',
    ],
    'media_status' => [
        'processing' => 'Processing',
        'ready' => 'Ready',
        'failed' => 'Failed',
    ],
    'plate_blur_state' => [
        'blurred' => 'Blurred',
        'declined' => 'No plate visible',
        'unchecked' => 'Not checked',
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
        'forum' => 'Forum',
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
        'qr' => 'Stickers',
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
        'like' => 'Like',
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
    // M4.14 parts and businesses.
    'product_status' => ['active' => 'Active', 'archived' => 'Archived'],
    'business_status' => ['applied' => 'Applied', 'verified' => 'Verified', 'rejected' => 'Rejected', 'suspended' => 'Suspended'],
    'business_kind' => [
        'workshop' => 'Workshop',
        'tuner' => 'Tuner',
        'detailing' => 'Detailing',
        'wrapping' => 'Wrapping',
        'paint' => 'Paint shop',
        'dealer' => 'Dealer',
        'parts_shop' => 'Parts shop',
        'other' => 'Business',
    ],
    'business_legal_form' => [
        'sole_trader' => 'Sole trader',
        'ek' => 'e. K. (registered merchant)',
        'gbr' => 'GbR (civil-law partnership)',
        'ohg' => 'OHG (general partnership)',
        'kg' => 'KG (limited partnership)',
        'gmbh' => 'GmbH',
        'gmbh_co_kg' => 'GmbH & Co. KG',
        'ug' => 'UG (haftungsbeschränkt)',
        'ag' => 'AG',
        'other' => 'Other legal form',
    ],
    'business_role' => ['owner' => 'Owner', 'staff' => 'Team'],
    'mod_tag_status' => ['pending' => 'Pending', 'accepted' => 'Confirmed', 'declined' => 'Declined'],
    // M5.9b STREET DEX.
    'rarity' => ['street' => 'Street', 'tuned' => 'Tuned', 'rare' => 'Rare', 'legend' => 'Legend', 'ghost' => 'Ghost'],
    'dex_set_kind' => ['jdm' => 'JDM', 'brand' => 'Make', 'city' => 'City', 'season' => 'Season'],
    // M5.8 Forum.
    'forum_category_kind' => ['standard' => 'Category', 'make' => 'Make', 'region' => 'Region'],
    'forum_thread_status' => ['pending' => 'In review', 'published' => 'Published', 'rejected' => 'Not approved', 'removed' => 'Removed', 'merged' => 'Merged'],
    'forum_post_status' => ['pending' => 'In review', 'published' => 'Published', 'rejected' => 'Not approved', 'removed' => 'Removed'],
    'bundesland' => [
        'BW' => 'Baden-Württemberg', 'BY' => 'Bavaria', 'BE' => 'Berlin', 'BB' => 'Brandenburg', 'HB' => 'Bremen', 'HH' => 'Hamburg',
        'HE' => 'Hesse', 'MV' => 'Mecklenburg-Western Pomerania', 'NI' => 'Lower Saxony', 'NW' => 'North Rhine-Westphalia',
        'RP' => 'Rhineland-Palatinate', 'SL' => 'Saarland', 'SN' => 'Saxony', 'ST' => 'Saxony-Anhalt', 'SH' => 'Schleswig-Holstein',
        'TH' => 'Thuringia',
    ],
    // M5.4 Sticker (10 §2.3).
    'sticker_template' => [
        'classic' => 'Classic',
        'minimal' => 'Minimal',
        'banner' => 'Banner',
        'plate' => 'Plate',
        'vertical_jdm' => 'Vertical JDM',
        'round' => 'Round',
    ],
    'sticker_colourway' => [
        'white' => 'White print',
        'black' => 'Black print',
        'white_red' => 'White with Signal Red',
    ],
    'sticker_material' => [
        'transparent' => 'Transparent vinyl',
        'white_vinyl' => 'White vinyl',
    ],
    'sticker_size' => [
        's' => 'S',
        'm' => 'M',
        'l' => 'L',
    ],
    'sticker_scan_test' => [
        'passed' => 'Scan test passed',
        'failed' => 'Scan test failed',
        'not_applicable' => 'Without QR code',
    ],
    'sticker_client_scan_test' => [
        'passed' => 'Passed',
        'failed' => 'Failed',
        'unavailable' => 'Not possible',
    ],
    // M5.5 Shop (10 §3).
    'shop_category' => [
        'sticker' => 'Stickers',
        'apparel' => 'Apparel',
        'accessories' => 'Accessories',
    ],
    'shop_variant_kind' => [
        'size' => 'Size',
        'colour' => 'Colour',
        'variant' => 'Option',
    ],
    'shop_purchase_mode' => [
        'shopify' => 'In the online shop',
        'sticker_designer' => 'Through the sticker designer',
    ],
    'shop_banner_link' => [
        'product' => 'Product',
        'category' => 'Category',
    ],
    // M5.7 (10 §6.1): the sources of a counted view (INS-01 "Top-Quellen").
    'view_source' => [
        'app' => 'App',
        'web' => 'Web',
        'sticker_scan' => 'Sticker scan',
        'shared_link' => 'Shared link',
    ],
];
