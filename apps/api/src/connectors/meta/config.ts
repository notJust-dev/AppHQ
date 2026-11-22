export const FACEBOOK = 'facebook'
export const INSTAGRAM = 'instagram'
export const META_PROVIDERS = [FACEBOOK, INSTAGRAM] as const

/** Graph API v27.0 came out on 2026-11-04; Meta supports a version for about two years. */
export const GRAPH_VERSION = 'v27.0'

/**
 * What the sign-in asks for. With Facebook Login for Business these come from the login
 * configuration (META_LOGIN_CONFIG_ID); the list is only sent as `scope` without one.
 */
export const META_PERMISSIONS = [
  'pages_show_list',
  'pages_read_engagement',
  'pages_read_user_content',
  'read_insights',
  'instagram_basic',
  'instagram_manage_insights',
  'business_management',
] as const

export interface MetaConfig {
  appId: string
  appSecret: string
  /** Facebook Login for Business configuration; null falls back to a `scope` list. */
  loginConfigId: string | null
  graphUrl: string
  dialogUrl: string
}

export class MetaNotConfiguredError extends Error {
  constructor() {
    super(
      'Facebook and Instagram are not set up on the API yet. Set META_APP_ID, META_APP_SECRET ' +
        'and META_LOGIN_CONFIG_ID on the api app, from your Meta app.',
    )
    this.name = 'MetaNotConfiguredError'
  }
}

/** The Meta app's credentials, or null when they are not set. The URLs can point at a stand-in. */
export function metaConfig(env: NodeJS.ProcessEnv = process.env): MetaConfig | null {
  const appId = env.META_APP_ID?.trim()
  const appSecret = env.META_APP_SECRET?.trim()
  if (!appId || !appSecret) return null
  return {
    appId,
    appSecret,
    loginConfigId: env.META_LOGIN_CONFIG_ID?.trim() || null,
    graphUrl: env.META_GRAPH_URL?.trim() || 'https://graph.facebook.com',
    dialogUrl: env.META_DIALOG_URL?.trim() || 'https://www.facebook.com',
  }
}

export function requireMetaConfig(env?: NodeJS.ProcessEnv): MetaConfig {
  const config = metaConfig(env)
  if (!config) throw new MetaNotConfiguredError()
  return config
}
