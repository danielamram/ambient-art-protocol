/**
 * @ambient/sources
 *
 * Built-in data source plugins, each made with createSource() from @ambient/sdk.
 * All of them run in the browser with no API key. In Node, pass an EventSource or WebSocket
 * implementation through the config.
 */
export { createMockSource } from '@ambient/sdk/testing';
export {
  BINANCE_MARKET_DATA_WS,
  type BinanceTrade,
  type BinanceTradesConfig,
  binanceTrades,
  mapTrade,
  summarizeWindow,
  type WebSocketInstance,
  type WebSocketLike,
} from './binance-trades.js';
export { type Openable, waitForOpen } from './connect.js';
export { hashToPoint, RateWindow, RollingSeries } from './stats.js';
export {
  type EventSourceInstance,
  type EventSourceLike,
  mapRecentChange,
  type RecentChange,
  WIKIMEDIA_RECENTCHANGE_URL,
  type WikipediaEditsConfig,
  wikipediaEdits,
} from './wikipedia-edits.js';
