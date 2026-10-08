/** Strip terminal controls from persisted/provider text before rendering it. Keep
 * original data in the private transcript; never interpret it as terminal input. */
export const safeText = (text: string) => text.replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, "");
