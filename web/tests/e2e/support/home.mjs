// Start (HOME-01) and its Car of the Day (M5.9, 10 §16). When the Home modules carry `car_of_the_day`, the pick leads Für dich
// (HOME-01.cotd) in place of the first featured build (HOME-01.featured; HomeScreen.tsx homeRows). Whether the server has a pick depends
// on the calendar, not on the test: GiftDemoSeeder (part of DemoShowcaseSeeder, M5.10) seeds one for each day from 14 days back to 3
// ahead, published at 18:00 Europe/Berlin, and CarOfTheDayCommand adds the next ones where the scheduler runs. A spec about the featured
// lead therefore takes the pick out of the server's own answer, and a spec about the pick asserts that the server has one.

/** GET home/modules, with or without a query. */
export const HOME_MODULES = /\/api\/v1\/home\/modules(\?.*)?$/;

/**
 * Start without a Car of the Day: the server's Home modules, `car_of_the_day` removed (as before 18:00 on the first day, or on a skipped
 * day), so the first featured build leads. Everything else is the server's answer, status and headers included.
 * @param {import('@playwright/test').Page} page
 */
export async function withoutCarOfTheDay(page) {
  await page.route(HOME_MODULES, async (route) => {
    // A browser that kept the answer sends its ETag and would get a bodiless 304 (visual/route-steps.mjs `patch`): ask for the full one.
    const headers = { ...route.request().headers() };
    delete headers['if-none-match'];
    delete headers['if-modified-since'];
    const response = await route.fetch({ headers });
    const body = await response.json();
    if (body && typeof body === 'object' && body.data && typeof body.data === 'object') delete body.data.car_of_the_day;
    await route.fulfill({ response, json: body });
  });
}

/** The lead of Für dich, whichever it is today: the Car of the Day or the first featured build. */
export const HOME_LEAD = '[data-testid="HOME-01.cotd"]:visible, [data-testid="HOME-01.featured"]:visible';
