/**
 * Native embeds every face through the expo-font config plugin (app.config.ts), so nothing is downloaded at runtime and
 * native bundles carry no woff2. The member web gets its files from webFontFiles.web.ts.
 */
export const webFontFiles: Readonly<Partial<Record<string, number>>> = {};

/** The Latin Extended files of the member web (webFontFiles.web.ts); native has these letters in its embedded TTFs. */
export const webLatinExtFiles: Readonly<Partial<Record<string, number>>> = {};
