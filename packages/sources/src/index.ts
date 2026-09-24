/**
 * @ambient/sources
 *
 * Built-in data source plugins, each made with createSource() from @ambient/sdk.
 * All of them run in the browser with no API key: Wikimedia edits, Binance trades, Bluesky
 * (Jetstream), USGS earthquakes and NOAA space weather. In Node, pass an EventSource or WebSocket
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
export {
  activityPulse,
  type BlueskyActivity,
  type BlueskyJetstreamConfig,
  type BlueskyKind,
  blueskyJetstream,
  classifyEvent,
  containsWord,
  emojiBalance,
  JETSTREAM_URL,
  type JetstreamEvent,
  jetstreamUrl,
  languagePoint,
} from './bluesky-jetstream.js';
export { type Openable, waitForOpen } from './connect.js';
export { type FetchLike, fetchJson, resolveFetch, startPolling } from './poll.js';
export {
  mapSpaceWeather,
  parseKp,
  parseTableColumn,
  type SpaceWeatherConfig,
  type SpaceWeatherReading,
  SWPC_KP_URL,
  SWPC_MAG_URL,
  SWPC_PLASMA_URL,
  spaceWeather,
} from './space-weather.js';
export { hashToPoint, RateWindow, RollingSeries } from './stats.js';
export {
  geoToCanvas,
  parseFeed,
  parseQuake,
  type Quake,
  type QuakeFeature,
  quakePulse,
  summarizeQuakes,
  USGS_FEED_BASE,
  type UsgsEarthquakesConfig,
  usgsEarthquakes,
} from './usgs-earthquakes.js';
export {
  type EventSourceInstance,
  type EventSourceLike,
  mapRecentChange,
  type RecentChange,
  WIKIMEDIA_RECENTCHANGE_URL,
  type WikipediaEditsConfig,
  wikipediaEdits,
} from './wikipedia-edits.js';
