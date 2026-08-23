/**
 * THE MULTIVERSE PORTAL - HYBRID MESH / DTN MESSAGING ARCHITECTURE
 * Core Data Models & Pluggable Transport Abstractions
 */

export const TransportType = {
  WEBSOCKET: 'WEBSOCKET',
  WEBRTC_P2P: 'WEBRTC_P2P',
  BLE: 'BLE',
  LOOPBACK: 'LOOPBACK'
};

export const PriorityClass = {
  CRITICAL: 0,
  HIGH: 1,
  NORMAL: 2,
  LOW: 3
};

export const DeliveryState = {
  QUEUED_LOCAL: 'QUEUED_LOCAL',
  TRANSMITTING: 'TRANSMITTING',
  FORWARDED_TO_RELAY: 'FORWARDED_TO_RELAY',
  DELIVERED_TO_DESTINATION: 'DELIVERED_TO_DESTINATION',
  DECRYPTED_AND_SEEN: 'DECRYPTED_AND_SEEN',
  FAILED_EXPIRED: 'FAILED_EXPIRED'
};

export class BaseTransport {
  constructor(name, type) {
    this.name = name;
    this.type = type;
    this.isAvailable = false;
    this.isConnected = false;
    this.onPeerDiscovered = null;
    this.onPeerDisconnected = null;
    this.onEnvelopeReceived = null;
  }

  async initialize() { throw new Error('Not implemented'); }
  async startDiscovery() { throw new Error('Not implemented'); }
  async stopDiscovery() { throw new Error('Not implemented'); }
  async sendEnvelope(peerId, envelope) { throw new Error('Not implemented'); }
  async disconnectPeer(peerId) { throw new Error('Not implemented'); }
}

export class PeerRouteScore {
  constructor(peerId) {
    this.peerId = peerId;
    this.rssi = -70;
    this.batteryLevel = 1.0;
    this.encounterFrequency = 1;
    this.linkQuality = 0.8;
    this.queueBacklog = 0;
  }

  calculateScore() {
    const rssiFactor = Math.max(0, (this.rssi + 100) / 60);
    const batteryFactor = this.batteryLevel;
    const congestionFactor = Math.max(0, 1 - (this.queueBacklog / 500));
    return (rssiFactor * 0.4) + (batteryFactor * 0.3) + (congestionFactor * 0.3);
  }
}
