import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';
import { BusinessError } from '@/common/errors/business-error';

export interface EncryptedPayload {
  v: 1;
  kid?: string;
  alg: 'aes-256-gcm';
  iv: string;
  tag: string;
  ct: string;
}

const ALGORITHM = 'aes-256-gcm' as const;
const IV_BYTE_LENGTH = 12;
const AUTH_TAG_BYTE_LENGTH = 16;
const KEY_BYTE_LENGTH = 32;
const HEX_KEY_REGEX = /^[0-9a-fA-F]{64}$/;
const BASE64_REGEX = /^[A-Za-z0-9+/]+={0,2}$/;

/**
 * Provides AES-256-GCM secret encryption and zero-downtime key rotation
 * via `AUTH_CONFIG_ENCRYPTION_KEY` and fallback `AUTH_CONFIG_ENCRYPTION_KEY_PREV`.
 */
@Injectable()
export class CryptoService {
  constructor(private readonly configService: ConfigService) {}

  hasEncryptionKey(): boolean {
    return this.getActiveKey() !== null;
  }

  encryptSecret(plaintext: string): EncryptedPayload {
    const key = this.requireActiveKey();
    const iv = randomBytes(IV_BYTE_LENGTH);
    const cipher = createCipheriv(ALGORITHM, key, iv, {
      authTagLength: AUTH_TAG_BYTE_LENGTH,
    });

    const ct = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();

    return {
      v: 1,
      kid: this.computeKid(key),
      alg: ALGORITHM,
      iv: iv.toString('base64'),
      tag: tag.toString('base64'),
      ct: ct.toString('base64'),
    };
  }

  decryptSecret(payload: EncryptedPayload): string {
    if (!payload || payload.v !== 1 || payload.alg !== ALGORITHM) {
      throw BusinessError.badRequest(
        'Unsupported encrypted payload format',
        'INVALID_ENCRYPTED_PAYLOAD',
      );
    }

    const keys = [this.getActiveKey(), this.getPreviousKey()].filter(
      (key): key is Buffer => key !== null,
    );

    if (keys.length === 0) {
      throw this.missingKeyError();
    }

    for (const key of keys) {
      try {
        return this.decryptWithKey(payload, key);
      } catch {
        // Fallback to previous key when active key auth tag verification fails
      }
    }

    throw BusinessError.badRequest(
      'Failed to decrypt secret payload',
      'SECRET_DECRYPTION_FAILED',
    );
  }

  mergeSecrets(
    existing: Record<string, EncryptedPayload>,
    incoming: Record<string, string | null | undefined>,
    clearKeys?: string[],
  ): Record<string, EncryptedPayload> {
    const merged: Record<string, EncryptedPayload> = { ...(existing ?? {}) };

    for (const [key, value] of Object.entries(incoming ?? {})) {
      if (typeof value === 'string' && value.length > 0) {
        merged[key] = this.encryptSecret(value);
      }
    }

    for (const key of clearKeys ?? []) {
      delete merged[key];
    }

    return merged;
  }

  private getActiveKey(): Buffer | null {
    const raw = this.configService.get<string>('AUTH_CONFIG_ENCRYPTION_KEY', {
      infer: true,
    });
    return this.parseKey(raw);
  }

  private getPreviousKey(): Buffer | null {
    const raw = this.configService.get<string>(
      'AUTH_CONFIG_ENCRYPTION_KEY_PREV',
      { infer: true },
    );
    return this.parseKey(raw);
  }

  private requireActiveKey(): Buffer {
    const key = this.getActiveKey();
    if (!key) {
      throw this.missingKeyError();
    }
    return key;
  }

  private missingKeyError(): BusinessError {
    return BusinessError.badRequest(
      'AUTH_CONFIG_ENCRYPTION_KEY is missing or invalid (expected 32-byte hex or base64 key)',
      'ENCRYPTION_KEY_MISSING',
    );
  }

  private parseKey(raw?: string): Buffer | null {
    const trimmed = raw?.trim();
    if (!trimmed) {
      return null;
    }

    if (HEX_KEY_REGEX.test(trimmed)) {
      return Buffer.from(trimmed, 'hex');
    }

    if (BASE64_REGEX.test(trimmed)) {
      const buf = Buffer.from(trimmed, 'base64');
      if (buf.length === KEY_BYTE_LENGTH) {
        return buf;
      }
    }

    return null;
  }

  private computeKid(key: Buffer): string {
    return createHash('sha256').update(key).digest('hex').slice(0, 16);
  }

  private decryptWithKey(payload: EncryptedPayload, key: Buffer): string {
    const iv = Buffer.from(payload.iv, 'base64');
    const tag = Buffer.from(payload.tag, 'base64');
    const ct = Buffer.from(payload.ct, 'base64');

    if (iv.length !== IV_BYTE_LENGTH || tag.length !== AUTH_TAG_BYTE_LENGTH) {
      throw new Error('Invalid IV or auth tag length');
    }

    const decipher = createDecipheriv(ALGORITHM, key, iv, {
      authTagLength: AUTH_TAG_BYTE_LENGTH,
    });
    decipher.setAuthTag(tag);

    return Buffer.concat([decipher.update(ct), decipher.final()]).toString(
      'utf8',
    );
  }
}
