/**
 * THE MULTIVERSE PORTAL - DTN MESH ROUTER ENGINE
 * Epidemiological Routing, Store-and-Forward Queuing, Deduplication, and Envelope Dispatching
 */

import { PriorityClass, PeerRouteScore } from './mesh-types.js';

export class MeshRouter {
  constructor(localUserId, store, transportManager) {
    this.localUserId = localUserId;
    this.store = store;
    this.transports = transportManager;
    this.routeScores = new Map();
    this.onEnvelopeDecrypted = null;
    this.onDeliveryReceipt = null;

    setInterval(() => this.maintenanceCycle(), 10000);
  }

  async routeOutgoingEnvelope(envelope) {
    await this.store.saveEnvelope(envelope);
    await this.attemptDirectDispatch(envelope);
  }

  async handleIncomingEnvelope(envelope, fromPeerId) {
    const alreadySeen = await this.store.hasSeenEnvelope(envelope.id);
    if (alreadySeen) return;

    await this.store.saveEnvelope(envelope);

    if (envelope.recipientId === this.localUserId) {
      if (envelope.type === 'DELIVERY_RECEIPT') {
        if (this.onDeliveryReceipt) this.onDeliveryReceipt(envelope);
      } else if (this.onEnvelopeDecrypted) {
        this.onEnvelopeDecrypted(envelope);
        await this.sendDeliveryReceipt(envelope);
      }
      return;
    }

    if (envelope.ttl <= 0 || envelope.hopCount >= envelope.maxHops) return;

    envelope.hopCount += 1;
    envelope.ttl -= 10000;

    await this.forwardEnvelopeToBestPeers(envelope, fromPeerId);
  }

  async attemptDirectDispatch(envelope) {
    const activePeers = this.transports.getActivePeers();
    if (activePeers.includes(envelope.recipientId)) {
      return await this.transports.sendToPeer(envelope.recipientId, envelope);
    }
    return false;
  }

  async forwardEnvelopeToBestPeers(envelope, excludePeerId) {
    const activePeers = this.transports.getActivePeers().filter(id => id !== excludePeerId);
    let forwardedCount = 0;

    for (const peerId of activePeers) {
      const scoreObj = this.routeScores.get(peerId) || new PeerRouteScore(peerId);
      if (scoreObj.calculateScore() > 0.3) {
        const success = await this.transports.sendToPeer(peerId, envelope);
        if (success) forwardedCount++;
      }
    }

    return forwardedCount > 0;
  }

  async sendDeliveryReceipt(originalEnvelope) {
    const receiptEnvelope = {
      id: `receipt_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      type: 'DELIVERY_RECEIPT',
      senderId: this.localUserId,
      recipientId: originalEnvelope.senderId,
      originalMessageId: originalEnvelope.id,
      timestamp: Date.now(),
      ttl: 86400000,
      hopCount: 0,
      maxHops: 10,
      priority: PriorityClass.CRITICAL,
      ciphertextB64: '',
      ivB64: ''
    };

    await this.routeOutgoingEnvelope(receiptEnvelope);
  }

  async maintenanceCycle() {
    await this.store.purgeExpired();

    const pendingEnvelopes = await this.store.getPendingEnvelopes(20);
    const activePeers = this.transports.getActivePeers();

    if (pendingEnvelopes.length > 0 && activePeers.length > 0) {
      for (const env of pendingEnvelopes) {
        await this.forwardEnvelopeToBestPeers(env, null);
      }
    }
  }

  updatePeerMetrics(peerId, rssi, batteryLevel) {
    let route = this.routeScores.get(peerId);
    if (!route) {
      route = new PeerRouteScore(peerId);
      this.routeScores.set(peerId, route);
    }
    if (rssi !== undefined) route.rssi = rssi;
    if (batteryLevel !== undefined) route.batteryLevel = batteryLevel;
  }
}
