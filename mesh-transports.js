/**
 * THE MULTIVERSE PORTAL - PLUGGABLE TRANSPORT MANAGER
 * Drivers for WebSocket, WebRTC DataChannel, and WebBluetooth (BLE)
 */

import { TransportType, BaseTransport } from './mesh-types.js';

export class WebSocketTransport extends BaseTransport {
  constructor(serverUrl, token) {
    super('WebSocket Internet Transport', TransportType.WEBSOCKET);
    this.serverUrl = serverUrl;
    this.token = token;
    this.ws = null;
  }

  async initialize() {
    return new Promise((resolve) => {
      this.ws = new WebSocket(this.serverUrl);
      this.ws.onopen = () => {
        this.isAvailable = true;
        this.isConnected = true;
        this.ws.send(JSON.stringify({ type: 'AUTH', token: this.token }));
        resolve(true);
      };
      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'MESH_ENVELOPE' && this.onEnvelopeReceived) {
            this.onEnvelopeReceived(data.envelope, 'GATEWAY_SERVER');
          }
        } catch (_) {}
      };
      this.ws.onerror = () => resolve(false);
      this.ws.onclose = () => { this.isConnected = false; };
    });
  }

  async sendEnvelope(peerId, envelope) {
    if (!this.isConnected || !this.ws) return false;
    this.ws.send(JSON.stringify({ type: 'RELAY_ENVELOPE', targetUserId: peerId, envelope }));
    return true;
  }
}

export class WebRTCP2PTransport extends BaseTransport {
  constructor() {
    super('WebRTC Local P2P Transport', TransportType.WEBRTC_P2P);
    this.peerConnections = new Map();
    this.dataChannels = new Map();
  }

  async initialize() {
    this.isAvailable = ('RTCPeerConnection' in window);
    return this.isAvailable;
  }

  async createPeerConnection(peerId, isInitiator, signalSignalingFn) {
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });

    this.peerConnections.set(peerId, pc);

    if (isInitiator) {
      const dc = pc.createDataChannel('multiverse-mesh-channel');
      this.setupDataChannel(peerId, dc);
    } else {
      pc.ondatachannel = (e) => this.setupDataChannel(peerId, e.channel);
    }

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        signalSignalingFn({ type: 'ICE', candidate: e.candidate, peerId });
      }
    };

    if (isInitiator) {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      signalSignalingFn({ type: 'OFFER', offer, peerId });
    }

    return pc;
  }

  setupDataChannel(peerId, dc) {
    this.dataChannels.set(peerId, dc);
    dc.onopen = () => {
      if (this.onPeerDiscovered) this.onPeerDiscovered({ id: peerId, type: TransportType.WEBRTC_P2P });
    };
    dc.onmessage = (e) => {
      try {
        const envelope = JSON.parse(e.data);
        if (this.onEnvelopeReceived) this.onEnvelopeReceived(envelope, peerId);
      } catch (_) {}
    };
    dc.onclose = () => {
      this.dataChannels.delete(peerId);
      if (this.onPeerDisconnected) this.onPeerDisconnected(peerId);
    };
  }

  async sendEnvelope(peerId, envelope) {
    const dc = this.dataChannels.get(peerId);
    if (dc && dc.readyState === 'open') {
      dc.send(JSON.stringify(envelope));
      return true;
    }
    return false;
  }
}

export class WebBluetoothTransport extends BaseTransport {
  constructor() {
    super('WebBluetooth BLE Transport', TransportType.BLE);
    this.device = null;
    this.characteristic = null;
    this.SERVICE_UUID = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
    this.CHARACTERISTIC_UUID = '6e400002-b5a3-f393-e0a9-e50e24dcca9e';
  }

  async initialize() {
    this.isAvailable = ('bluetooth' in navigator);
    return this.isAvailable;
  }

  async startDiscovery() {
    if (!this.isAvailable) throw new Error('WebBluetooth API unavailable');

    try {
      this.device = await navigator.bluetooth.requestDevice({
        filters: [{ services: [this.SERVICE_UUID] }],
        optionalServices: [this.SERVICE_UUID]
      });

      const server = await this.device.gatt.connect();
      const service = await server.getPrimaryService(this.SERVICE_UUID);
      this.characteristic = await service.getCharacteristic(this.CHARACTERISTIC_UUID);

      await this.characteristic.startNotifications();
      this.characteristic.addEventListener('characteristicvaluechanged', (event) => {
        const jsonStr = new TextDecoder().decode(event.target.value);
        try {
          const envelope = JSON.parse(jsonStr);
          if (this.onEnvelopeReceived) this.onEnvelopeReceived(envelope, this.device.id);
        } catch (_) {}
      });

      this.isConnected = true;
      if (this.onPeerDiscovered) this.onPeerDiscovered({ id: this.device.id, name: this.device.name, type: TransportType.BLE });
      return true;
    } catch (err) {
      return false;
    }
  }

  async sendEnvelope(peerId, envelope) {
    if (!this.characteristic || !this.isConnected) return false;
    try {
      const jsonBytes = new TextEncoder().encode(JSON.stringify(envelope));
      const maxChunk = 512;
      for (let offset = 0; offset < jsonBytes.length; offset += maxChunk) {
        const chunk = jsonBytes.slice(offset, offset + maxChunk);
        await this.characteristic.writeValueWithResponse(chunk);
      }
      return true;
    } catch (err) {
      return false;
    }
  }
}

export class TransportManager {
  constructor() {
    this.transports = new Map();
    this.activePeers = new Map();
    this.onPeerConnected = null;
    this.onPeerDisconnected = null;
    this.onEnvelopeReceived = null;
  }

  registerTransport(transport) {
    this.transports.set(transport.type, transport);

    transport.onPeerDiscovered = (peer) => {
      this.activePeers.set(peer.id, { transport, peer });
      if (this.onPeerConnected) this.onPeerConnected(peer);
    };

    transport.onPeerDisconnected = (peerId) => {
      this.activePeers.delete(peerId);
      if (this.onPeerDisconnected) this.onPeerDisconnected(peerId);
    };

    transport.onEnvelopeReceived = (envelope, fromPeerId) => {
      if (this.onEnvelopeReceived) this.onEnvelopeReceived(envelope, fromPeerId);
    };
  }

  getActivePeers() {
    return Array.from(this.activePeers.keys());
  }

  async sendToPeer(peerId, envelope) {
    const session = this.activePeers.get(peerId);
    if (session) {
      return await session.transport.sendEnvelope(peerId, envelope);
    }

    let sent = false;
    for (const transport of this.transports.values()) {
      if (transport.isConnected) {
        const ok = await transport.sendEnvelope(peerId, envelope);
        if (ok) sent = true;
      }
    }
    return sent;
  }
  }
