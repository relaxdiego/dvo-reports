/**
 * What this build is, and where its backend lives.
 *
 * Read off the page at startup rather than baked into the bundle, so one
 * build can be published to staging and to production. The deploy job
 * writes both values into the `<html>` tag of the copy it publishes.
 *
 * The default is deliberately not production. A page that does not say what
 * it is gets the bar saying so, the same way a build not told `DEPLOY_ENV`
 * did when this was a compile-time constant.
 */
const cfg = document.documentElement.dataset

export const ENVIRONMENT = cfg.env || 'development'
export const API_BASE = cfg.api || ''
