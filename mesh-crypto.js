/**
 * THE MULTIVERSE PORTAL - MESH CRYPTOGRAPHIC ENGINE
 * Web Crypto API: ECDH P-256 + HKDF SHA-256 + AES-256-GCM + HMAC/SHA-256 Signatures
 */

export class MeshCrypto {
  static async generateIdentityKeyPair() {
    const ecdhPair = await window.crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' },
      false,
      ['deriveKey', 'deriveBits']
    );

    const signKey = await window.crypto.subtle.generateKey(
      { name: 'HMAC', hash: 'SHA-256', length: 256 },
      true,
      ['sign', 'verify']
    );

    return { ecdhPair, signKey };
  }

  static async exportPublicKey(key) {
    const exported = await window.crypto.subtle.exportKey('spki', key);
    return btoa(String.fromCharCode(...new Uint8Array(exported)));
  }

  static async importPublicKey(spkiB64) {
    const binary = atob(spkiB64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return window.crypto.subtle.importKey(
      'spki',
      bytes.buffer,
      { name: 'ECDH', namedCurve: 'P-256' },
      true,
      []
    );
  }

  static async deriveSessionKey(privateKey, partnerPublicKey) {
    const derivedBits = await window.crypto.subtle.deriveBits(
      { name: 'ECDH', public: partnerPublicKey },
      privateKey,
      256
    );

    const hkdfKey = await window.crypto.subtle.importKey('raw', derivedBits, 'HKDF', false, ['deriveKey']);
    return window.crypto.subtle.deriveKey(
      {
        name: 'HKDF',
        hash: 'SHA-256',
        salt: new Uint8Array(16),
        info: new TextEncoder().encode('MULTIVERSE_MESH_E2EE_V2')
      },
      hkdfKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  static async encryptPayload(sessionKey, plaintext) {
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const encoded = new TextEncoder().encode(plaintext);
    const ciphertextBuf = await window.crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      sessionKey,
      encoded
    );

    return {
      ciphertextB64: btoa(String.fromCharCode(...new Uint8Array(ciphertextBuf))),
      ivB64: btoa(String.fromCharCode(...iv))
    };
  }

  static async decryptPayload(sessionKey, ciphertextB64, ivB64) {
    try {
      const ciphertext = new Uint8Array(atob(ciphertextB64).split('').map(c => c.charCodeAt(0)));
      const iv = new Uint8Array(atob(ivB64).split('').map(c => c.charCodeAt(0)));
      const decryptedBuf = await window.crypto.subtle.decrypt(
        { name: 'AES-GCM', iv },
        sessionKey,
        ciphertext
      );
      return new TextDecoder().decode(decryptedBuf);
    } catch (e) {
      throw new Error('E2EE Decryption Failed: Invalid Ciphertext or Session Key mismatch');
    }
  }

  static async signEnvelope(signKey, envelopeHeader) {
    const dataStr = `${envelopeHeader.id}:${envelopeHeader.senderId}:${envelopeHeader.recipientId}:${envelopeHeader.timestamp}:${envelopeHeader.ttl}`;
    const encoded = new TextEncoder().encode(dataStr);
    const sigBuf = await window.crypto.subtle.sign('HMAC', signKey, encoded);
    return btoa(String.fromCharCode(...new Uint8Array(sigBuf)));
  }

  static async computeHash(dataBuffer) {
    const hashBuf = await window.crypto.subtle.digest('SHA-256', dataBuffer);
    return btoa(String.fromCharCode(...new Uint8Array(hashBuf)));
  }
      }
