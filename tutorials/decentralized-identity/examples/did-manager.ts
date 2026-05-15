import { generateKeyPair } from '@midnight-ntwrk/did-sdk';
import { randomBytes } from 'crypto';

export interface DIDDocument {
  '@context': string[];
  id: string;
  created: string;
  updated: string;
  verificationMethod: VerificationMethod[];
  authentication: string[];
  assertionMethod: string[];
  capabilityDelegation: string[];
  service: ServiceEndpoint[];
}

export interface VerificationMethod {
  id: string;
  type: string;
  controller: string;
  publicKeyMultibase: string;
}

export interface ServiceEndpoint {
  id: string;
  type: string;
  serviceEndpoint: string;
}

export class DIDManager {
  private didDocuments: Map<string, DIDDocument> = new Map();
  private keyPairs: Map<string, any> = new Map();

  async createDID(userId: string): Promise<DIDDocument> {
    const identifier = randomBytes(16).toString('hex');
    const did = `did:midnight:${identifier}`;
    const keyPair = await generateKeyPair();
    
    const verificationMethod: VerificationMethod = {
      id: `${did}#key-1`,
      type: 'Ed25519VerificationKey2020',
      controller: did,
      publicKeyMultibase: keyPair.publicKeyMultibase
    };

    const didDocument: DIDDocument = {
      '@context': [
        'https://www.w3.org/ns/did/v1',
        'https://w3id.org/security/suites/ed25519-2020/v1'
      ],
      id: did,
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
      verificationMethod: [verificationMethod],
      authentication: [`${did}#key-1`],
      assertionMethod: [`${did}#key-1`],
      capabilityDelegation: [`${did}#key-1`],
      service: []
    };

    this.didDocuments.set(did, didDocument);
    this.keyPairs.set(did, keyPair);
    return didDocument;
  }

  async resolveDID(did: string): Promise<DIDDocument | null> {
    return this.didDocuments.get(did) || null;
  }

  async updateDID(did: string, updates: Partial<DIDDocument>): Promise<DIDDocument> {
    const existing = this.didDocuments.get(did);
    if (!existing) throw new Error(`DID not found: ${did}`);
    const updated = { ...existing, ...updates, updated: new Date().toISOString() };
    this.didDocuments.set(did, updated);
    return updated;
  }

  async deactivateDID(did: string): Promise<boolean> {
    if (!this.didDocuments.has(did)) return false;
    this.didDocuments.delete(did);
    this.keyPairs.delete(did);
    return true;
  }

  async addService(did: string, service: ServiceEndpoint): Promise<DIDDocument> {
    const doc = this.didDocuments.get(did);
    if (!doc) throw new Error(`DID not found: ${did}`);
    doc.service.push(service);
    doc.updated = new Date().toISOString();
    return doc;
  }
}
