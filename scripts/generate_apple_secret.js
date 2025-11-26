#!/usr/bin/env node

/**
 * Apple Sign-In Secret Key Generator
 *
 * Generates a JWT client secret for Apple Sign-In OAuth flow.
 * The secret is required for Supabase Apple authentication.
 *
 * Usage: node scripts/generate_apple_secret.js
 *
 * @module scripts/generate_apple_secret
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function question(prompt) {
  return new Promise((resolve) => {
    rl.question(prompt, resolve);
  });
}

/**
 * Base64URL encode (RFC 7515)
 */
function base64UrlEncode(buffer) {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

/**
 * Generate JWT for Apple Sign-In
 */
function generateAppleClientSecret(teamId, keyId, clientId, privateKey, expirationMonths = 6) {
  const now = Math.floor(Date.now() / 1000);
  const expiration = now + expirationMonths * 30 * 24 * 60 * 60; // months to seconds

  // JWT Header
  const header = {
    alg: 'ES256',
    kid: keyId,
    typ: 'JWT',
  };

  // JWT Payload
  const payload = {
    iss: teamId,
    iat: now,
    exp: expiration,
    aud: 'https://appleid.apple.com',
    sub: clientId,
  };

  // Encode header and payload
  const encodedHeader = base64UrlEncode(Buffer.from(JSON.stringify(header)));
  const encodedPayload = base64UrlEncode(Buffer.from(JSON.stringify(payload)));

  // Create signature
  const signatureInput = `${encodedHeader}.${encodedPayload}`;

  // Parse PEM private key
  const privateKeyObject = crypto.createPrivateKey({
    key: privateKey,
    format: 'pem',
  });

  // Sign with ES256 (ECDSA using P-256 curve and SHA-256)
  const signature = crypto.sign('sha256', Buffer.from(signatureInput), {
    key: privateKeyObject,
    dsaEncoding: 'ieee-p1363', // Required for JWT ES256 format
  });

  const encodedSignature = base64UrlEncode(signature);

  return `${encodedHeader}.${encodedPayload}.${encodedSignature}`;
}

async function main() {
  console.log('\n🍎 Apple Sign-In Secret Key Generator\n');
  console.log('This script generates a JWT client secret for Apple Sign-In.');
  console.log('You will need this secret for Supabase Apple authentication.\n');
  console.log('─'.repeat(50) + '\n');

  // Get Team ID
  const teamId = await question('📋 Enter your Apple Team ID (e.g., 8L8M2BK473): ');
  if (!teamId.trim()) {
    console.error('❌ Team ID is required');
    rl.close();
    process.exit(1);
  }

  // Get Key ID
  const keyId = await question('🔑 Enter your Key ID (from Apple Developer > Keys): ');
  if (!keyId.trim()) {
    console.error('❌ Key ID is required');
    rl.close();
    process.exit(1);
  }

  // Get Client ID (Service ID)
  const clientId = await question(
    '🆔 Enter your Service ID / Client ID (e.g., com.planor.template.signin): '
  );
  if (!clientId.trim()) {
    console.error('❌ Client ID is required');
    rl.close();
    process.exit(1);
  }

  // Get .p8 file path
  const p8Path = await question('📁 Enter the path to your .p8 private key file: ');
  if (!p8Path.trim()) {
    console.error('❌ Private key path is required');
    rl.close();
    process.exit(1);
  }

  // Resolve and read the .p8 file
  const resolvedPath = path.resolve(p8Path.trim());
  if (!fs.existsSync(resolvedPath)) {
    console.error(`❌ File not found: ${resolvedPath}`);
    rl.close();
    process.exit(1);
  }

  const privateKey = fs.readFileSync(resolvedPath, 'utf8');

  // Get expiration (optional, default 6 months)
  const expirationInput = await question('⏰ Expiration in months (default: 6): ');
  const expirationMonths = parseInt(expirationInput.trim()) || 6;

  rl.close();

  console.log('\n⏳ Generating secret...\n');

  try {
    const secret = generateAppleClientSecret(
      teamId.trim(),
      keyId.trim(),
      clientId.trim(),
      privateKey,
      expirationMonths
    );

    const expirationDate = new Date(Date.now() + expirationMonths * 30 * 24 * 60 * 60 * 1000);

    console.log('─'.repeat(50));
    console.log('\n✅ Apple Client Secret Generated Successfully!\n');
    console.log('─'.repeat(50));
    console.log('\n📋 Copy this secret and paste it into Supabase:\n');
    console.log('─'.repeat(50));
    console.log('\n' + secret + '\n');
    console.log('─'.repeat(50));
    console.log('\n📅 Expires: ' + expirationDate.toLocaleDateString());
    console.log('⚠️  Remember to regenerate before expiration!\n');
    console.log('📍 Supabase Dashboard > Authentication > Providers > Apple > Secret Key\n');
  } catch (error) {
    console.error('❌ Error generating secret:', error.message);
    process.exit(1);
  }
}

main();
