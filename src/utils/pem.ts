/**
 * Converts a SEC1 EC private key PEM (-----BEGIN EC PRIVATE KEY-----)
 * to PKCS#8 PEM (-----BEGIN PRIVATE KEY-----) using pure Buffer arithmetic,
 * with no OpenSSL/createPrivateKey call.
 *
 * The CDP SDK (jose v6) needs importPKCS8 → crypto.subtle.importKey('pkcs8'),
 * so we must hand it a proper PKCS#8 wrapper. We hard-code the fixed DER frame
 * for P-256 (prime256v1) and splice in the 32-byte private scalar.
 */
export function sec1ToP256Pkcs8Pem(sec1Pem: string): string {
  // 1. Extract the raw DER from the SEC1 PEM
  const b64 = sec1Pem
    .replace(/-----BEGIN EC PRIVATE KEY-----/, '')
    .replace(/-----END EC PRIVATE KEY-----/, '')
    .replace(/\s+/g, '');
  const der = Buffer.from(b64, 'base64');

  // 2. Parse the SEC1 structure: SEQUENCE { INTEGER 1, OCTET STRING(privkey), ... }
  let i = 0;
  if (der[i++] !== 0x30) throw new Error('SEC1: expected SEQUENCE');
  // skip length (definite short or long form)
  if (der[i] & 0x80) i += (der[i] & 0x7f) + 1; else i++;
  // skip INTEGER 1  (02 01 01)
  if (der[i] !== 0x02 || der[i + 1] !== 0x01 || der[i + 2] !== 0x01)
    throw new Error('SEC1: expected version INTEGER 1');
  i += 3;
  // next is OCTET STRING containing the 32-byte private scalar
  if (der[i] !== 0x04 || der[i + 1] !== 0x20)
    throw new Error('SEC1: expected 32-byte OCTET STRING for private key');
  const priv = der.slice(i + 2, i + 34);

  // 3. Build PKCS#8 DER for P-256. All lengths are fixed for a 32-byte key:
  //
  //   SEQUENCE (67 bytes total)
  //     INTEGER 0                        (version)
  //     SEQUENCE                         (algorithmIdentifier)
  //       OID 1.2.840.10045.2.1          (id-ecPublicKey)
  //       OID 1.2.840.10045.3.1.7        (prime256v1)
  //     OCTET STRING                     (privateKey)
  //       SEQUENCE                       (ECPrivateKey, no curve/pubkey)
  //         INTEGER 1
  //         OCTET STRING (32 bytes)      (private scalar)
  //
  const pkcs8 = Buffer.concat([
    Buffer.from([
      0x30, 0x41,                                           // SEQUENCE len=65
        0x02, 0x01, 0x00,                                   // INTEGER 0
        0x30, 0x13,                                         // SEQUENCE len=19
          0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01, // OID ecPublicKey
          0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07, // OID prime256v1
        0x04, 0x27,                                         // OCTET STRING len=39
          0x30, 0x25,                                       // SEQUENCE len=37
            0x02, 0x01, 0x01,                               // INTEGER 1
            0x04, 0x20,                                     // OCTET STRING len=32
    ]),
    priv,
  ]);

  // 4. Wrap in PEM
  const lines = pkcs8.toString('base64').match(/.{1,64}/g)!.join('\n');
  return `-----BEGIN PRIVATE KEY-----\n${lines}\n-----END PRIVATE KEY-----\n`;
}

/**
 * Normalises the CDP API key secret as the CDP SDK expects it:
 *   1. Replaces literal `\n` with real newlines (Railway stores env vars on
 *      a single line, so the key arrives escaped).
 *   2. Converts SEC1 EC PEM to PKCS#8 PEM so jose v6's importPKCS8 accepts it.
 *
 * Pure — no process.env mutation. Returns undefined for an empty/missing input.
 */
export function normalizeCdpApiKeySecret(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const unescaped = raw.replace(/\\n/g, '\n');
  if (unescaped.includes('-----BEGIN EC PRIVATE KEY-----')) {
    return sec1ToP256Pkcs8Pem(unescaped);
  }
  return unescaped;
}
