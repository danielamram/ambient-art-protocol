/**
 * @ambient/sources
 *
 * Phase 4 will add, each built with createSource() from @ambient/sdk:
 *   - mock-crypto:   polls mock price volatility, emits ambiance (mood = trend, turbulence = volatility)
 *   - webhook-pulse: Node HTTP endpoint; every JSON POST to /api/event emits a pulse
 *   - websocket:     generic WebSocket client with a user-supplied mapper fn
 *   - rest-poll:     generic polling client with a user-supplied mapper fn
 *
 * Until then, use `createMockSource` from '@ambient/sdk/testing'.
 */
export { createMockSource } from '@ambient/sdk/testing';
