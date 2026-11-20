import { createRevenueCatConnector } from './revenuecat/connector.js'
import type { Connector } from './types.js'

/** Connectors run by a sync, in order. App Store and Google Play come next. */
export const connectors: Connector[] = [createRevenueCatConnector()]
