/**
 * Every namespace of one language, as one module (M5.12a, 09 §12). Native imports both languages up front (languages.native.ts); the
 * member web loads only the active one, as its own chunk (languages.ts).
 */
import auth from '../locales/de/auth.json';
import common from '../locales/de/common.json';
import dex from '../locales/de/dex.json';
import discover from '../locales/de/discover.json';
import errors from '../locales/de/errors.json';
import events from '../locales/de/events.json';
import forum from '../locales/de/forum.json';
import garage from '../locales/de/garage.json';
import home from '../locales/de/home.json';
import messages from '../locales/de/messages.json';
import parts from '../locales/de/parts.json';
import profile from '../locales/de/profile.json';
import qr from '../locales/de/qr.json';
import safety from '../locales/de/safety.json';
import settings from '../locales/de/settings.json';
import shop from '../locales/de/shop.json';
import vehicle from '../locales/de/vehicle.json';

const bundle = { common, auth, home, discover, garage, vehicle, qr, dex, messages, events, forum, parts, profile, settings, shop, safety, errors };

export default bundle;
