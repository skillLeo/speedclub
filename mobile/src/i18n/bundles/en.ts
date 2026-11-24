/**
 * Every namespace of one language, as one module (M5.12a, 09 §12). Native imports both languages up front (languages.native.ts); the
 * member web loads only the active one, as its own chunk (languages.ts).
 */
import auth from '../locales/en/auth.json';
import common from '../locales/en/common.json';
import dex from '../locales/en/dex.json';
import discover from '../locales/en/discover.json';
import errors from '../locales/en/errors.json';
import events from '../locales/en/events.json';
import forum from '../locales/en/forum.json';
import garage from '../locales/en/garage.json';
import home from '../locales/en/home.json';
import messages from '../locales/en/messages.json';
import parts from '../locales/en/parts.json';
import profile from '../locales/en/profile.json';
import qr from '../locales/en/qr.json';
import safety from '../locales/en/safety.json';
import settings from '../locales/en/settings.json';
import shop from '../locales/en/shop.json';
import vehicle from '../locales/en/vehicle.json';

const bundle = { common, auth, home, discover, garage, vehicle, qr, dex, messages, events, forum, parts, profile, settings, shop, safety, errors };

export default bundle;
