import { DIDManager } from './did-manager';
import { CredentialManager } from './credential-manager';
import { ZKProofManager } from './zk-proof';

async function main() {
  console.log('=== Midnight Decentralized Identity System ===\n');

  const didManager = new DIDManager();
  const credentialManager = new CredentialManager(didManager);
  const zkProofManager = new ZKProofManager();

  // 1. Create DIDs
  console.log('1. Creating DIDs...');
  const alice = await didManager.createDID('alice');
  const university = await didManager.createDID('university');
  console.log('  Alice DID:', alice.id);
  console.log('  University DID:', university.id);

  // 2. Issue credentials
  console.log('\n2. Issuing Credential...');
  const degree = await credentialManager.issueCredential(
    university.id, alice.id,
    { degree: 'BSc Computer Science', gpa: 3.8, year: 2024 },
    365
  );
  console.log('  Credential:', degree.id);
  console.log('  Valid:', await credentialManager.verifyCredential(degree));

  // 3. Selective disclosure
  console.log('\n3. Selective Disclosure (hide GPA)...');
  const zkProof = await zkProofManager.generateSelectiveDisclosureProof(
    alice,
    { degree: 'BSc Computer Science', gpa: 3.8, year: 2024 },
    ['degree', 'year']
  );
  console.log('  Revealed:', zkProof.revealedAttributes);
  console.log('  Hidden:', zkProof.hiddenAttributes);
  console.log('  Valid:', await zkProofManager.verifyZKProof(zkProof, { degree: 'BSc Computer Science', year: 2024 }));

  // 4. Presentation
  console.log('\n4. Creating Presentation...');
  const pres = await credentialManager.createPresentation(alice.id, [degree.id]);
  console.log('  Credentials in presentation:', pres.verifiableCredential.length);

  console.log('\n=== Done ===');
}

main().catch(console.error);
