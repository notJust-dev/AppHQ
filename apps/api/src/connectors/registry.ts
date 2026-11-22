import { createAppStoreConnector } from './app-store/connector.js'
import { createGooglePlayConnector } from './google-play/connector.js'
import { createFacebookConnector } from './meta/facebook-connector.js'
import { createInstagramConnector } from './meta/instagram-connector.js'
import { createRevenueCatConnector } from './revenuecat/connector.js'
import { createTikTokConnector } from './tiktok/connector.js'
import type { Connector } from './types.js'

/** Connectors run by a sync, in order. */
export const connectors: Connector[] = [
  createRevenueCatConnector(),
  createAppStoreConnector(),
  createGooglePlayConnector(),
  createTikTokConnector(),
  createFacebookConnector(),
  createInstagramConnector(),
]
