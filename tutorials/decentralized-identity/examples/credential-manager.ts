import { DIDDocument, DIDManager } from './did-manager';

export interface VerifiableCredential {
  '@context': string[];
  id: string;
  type: string[];
  issuer: string;
  issuanceDate: string;
  expirationDate?: string;
  credentialSubject: { id: string; [key: string]: any };
  proof: Proof;
}

export interface Proof {
  type: string;
  created: string;
  verificationMethod: string;
  proofPurpose: string;
  proofValue: string;
}

export interface Presentation {
  '@context': string[];
  type: string[];
  verifiableCredential: VerifiableCredential[];
  proof: Proof;
}

export class CredentialManager {
  private didManager: DIDManager;
  private credentials: Map<string, VerifiableCredential> = new Map();

  constructor(didManager: DIDManager) {
    this.didManager = didManager;
  }

  async issueCredential(
    issuerDID: string,
    subjectDID: string,
    claims: Record<string, any>,
    expirationDays?: number
  ): Promise<VerifiableCredential> {
    const issuerDoc = await this.didManager.resolveDID(issuerDID);
    if (!issuerDoc) throw new Error(`Issuer DID not found: ${issuerDID}`);

    const credentialId = `urn:uuid:${crypto.randomUUID()}`;
    const issuanceDate = new Date().toISOString();
    let expirationDate: string | undefined;
    if (expirationDays) {
      const d = new Date();
      d.setDate(d.getDate() + expirationDays);
      expirationDate = d.toISOString();
    }

    const credential: VerifiableCredential = {
      '@context': ['https://www.w3.org/2018/credentials/v1'],
      id: credentialId,
      type: ['VerifiableCredential', 'MidnightIdentityCredential'],
      issuer: issuerDID,
      issuanceDate,
      expirationDate,
      credentialSubject: { id: subjectDID, ...claims },
      proof: {
        type: 'Ed25519Signature2020',
        created: issuanceDate,
        verificationMethod: `${issuerDoc.id}#key-1`,
        proofPurpose: 'assertionMethod',
        proofValue: Buffer.from(JSON.stringify({ credentialId, claims })).toString('base64')
      }
    };

    this.credentials.set(credentialId, credential);
    return credential;
  }

  async verifyCredential(credential: VerifiableCredential): Promise<boolean> {
    if (credential.expirationDate && new Date(credential.expirationDate) < new Date()) return false;
    const issuerDoc = await this.didManager.resolveDID(credential.issuer);
    return !!issuerDoc;
  }

  async createPresentation(holderDID: string, credentialIds: string[]): Promise<Presentation> {
    const creds = credentialIds.map(id => this.credentials.get(id)).filter(Boolean) as VerifiableCredential[];
    return {
      '@context': ['https://www.w3.org/2018/credentials/v1'],
      type: ['VerifiablePresentation'],
      verifiableCredential: creds,
      proof: {
        type: 'Ed25519Signature2020',
        created: new Date().toISOString(),
        verificationMethod: `${holderDID}#key-1`,
        proofPurpose: 'authentication',
        proofValue: Buffer.from(JSON.stringify({ creds: creds.map(c => c.id) })).toString('base64')
      }
    };
  }
}
