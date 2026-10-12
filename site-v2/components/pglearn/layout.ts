/*
 * The one content frame for PGLearn: the PG Labs `container-max` (1360px)
 * with the `gutter` (24px) on each side. The top bar and every page's <main>
 * use it, so the page's left edge always sits under the wordmark and its right
 * edge under the account actions. Pages whose content reads better narrower
 * (forms, long text) narrow their children, not this frame.
 */
export const pageContainer = "mx-auto w-full max-w-ui-container px-6";
