import { HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { randomBytes } from 'node:crypto';
import { BusinessError } from '@/common/errors/business-error';
import { CryptoModule } from './crypto.module';
import { CryptoService, type EncryptedPayload } from './crypto.service';

const makeHexKey = () => randomBytes(32).toString('hex');
const makeBase64Key = () => randomBytes(32).toString('base64');

const createServiceWithEnv = (
  envMap: Record<string, string | undefined>,
): CryptoService => {
  const mockConfigService = {
    get: jest.fn((key: string) => envMap[key]),
  } as unknown as ConfigService;

  return new CryptoService(mockConfigService);
};

describe('CryptoService', () => {
  describe('hasEncryptionKey', () => {
    it('should return true for valid 64-char hex key', () => {
      const service = createServiceWithEnv({
        AUTH_CONFIG_ENCRYPTION_KEY: makeHexKey(),
      });
      expect(service.hasEncryptionKey()).toBe(true);
    });

    it('should return true for valid base64 32-byte key', () => {
      const service = createServiceWithEnv({
        AUTH_CONFIG_ENCRYPTION_KEY: makeBase64Key(),
      });
      expect(service.hasEncryptionKey()).toBe(true);
    });

    it('should return false when key is empty or invalid length', () => {
      expect(
        createServiceWithEnv({
          AUTH_CONFIG_ENCRYPTION_KEY: '',
        }).hasEncryptionKey(),
      ).toBe(false);
      expect(createServiceWithEnv({}).hasEncryptionKey()).toBe(false);
      expect(
        createServiceWithEnv({
          AUTH_CONFIG_ENCRYPTION_KEY: randomBytes(16).toString('hex'),
        }).hasEncryptionKey(),
      ).toBe(false);
      expect(
        createServiceWithEnv({
          AUTH_CONFIG_ENCRYPTION_KEY: randomBytes(16).toString('base64'),
        }).hasEncryptionKey(),
      ).toBe(false);
    });
  });

  describe('encryptSecret and decryptSecret', () => {
    it('should round-trip plaintext with kid and unique IV per encryption (hex key)', () => {
      const service = createServiceWithEnv({
        AUTH_CONFIG_ENCRYPTION_KEY: makeHexKey(),
      });
      const plaintext = 'super-secret-oauth-client-secret';

      const payload1 = service.encryptSecret(plaintext);
      const payload2 = service.encryptSecret(plaintext);

      expect(payload1.v).toBe(1);
      expect(payload1.alg).toBe('aes-256-gcm');
      expect(typeof payload1.kid).toBe('string');
      expect(payload1.kid!.length).toBeGreaterThan(0);
      expect(Buffer.from(payload1.iv, 'base64').length).toBe(12);
      expect(Buffer.from(payload1.tag, 'base64').length).toBe(16);

      expect(payload1.iv).not.toBe(payload2.iv);
      expect(payload1.ct).not.toBe(payload2.ct);
      expect(payload1.kid).toBe(payload2.kid);

      expect(service.decryptSecret(payload1)).toBe(plaintext);
      expect(service.decryptSecret(payload2)).toBe(plaintext);
    });

    it('should round-trip plaintext using a 32-byte base64 key', () => {
      const service = createServiceWithEnv({
        AUTH_CONFIG_ENCRYPTION_KEY: makeBase64Key(),
      });
      const plaintext = 'base64-key-secret-value';
      const encrypted = service.encryptSecret(plaintext);

      expect(service.decryptSecret(encrypted)).toBe(plaintext);
    });

    it('should decrypt ciphertext encrypted with previous key after rotation via AUTH_CONFIG_ENCRYPTION_KEY_PREV', () => {
      const oldKey = makeHexKey();
      const newKey = makeBase64Key();

      const oldService = createServiceWithEnv({
        AUTH_CONFIG_ENCRYPTION_KEY: oldKey,
      });
      const legacyPayload = oldService.encryptSecret('legacy-secret-value');

      const rotatedService = createServiceWithEnv({
        AUTH_CONFIG_ENCRYPTION_KEY: newKey,
        AUTH_CONFIG_ENCRYPTION_KEY_PREV: oldKey,
      });

      expect(rotatedService.decryptSecret(legacyPayload)).toBe(
        'legacy-secret-value',
      );

      const freshPayload = rotatedService.encryptSecret('fresh-secret-value');
      expect(freshPayload.kid).not.toBe(legacyPayload.kid);
      expect(rotatedService.decryptSecret(freshPayload)).toBe(
        'fresh-secret-value',
      );
    });

    it('should fail to decrypt when ciphertext or auth tag is tampered', () => {
      const service = createServiceWithEnv({
        AUTH_CONFIG_ENCRYPTION_KEY: makeHexKey(),
        AUTH_CONFIG_ENCRYPTION_KEY_PREV: makeHexKey(),
      });
      const encrypted = service.encryptSecret('sensitive-data');
      const ctBuf = Buffer.from(encrypted.ct, 'base64');
      ctBuf[0] ^= 0xff;
      const tampered: EncryptedPayload = {
        ...encrypted,
        ct: ctBuf.toString('base64'),
      };

      expect(() => service.decryptSecret(tampered)).toThrow();
    });

    it('should throw BusinessError ENCRYPTION_KEY_MISSING on encryptSecret when key is missing or not 32 bytes', () => {
      const invalidConfigs = [
        { AUTH_CONFIG_ENCRYPTION_KEY: '' },
        {},
        { AUTH_CONFIG_ENCRYPTION_KEY: 'too-short' },
        { AUTH_CONFIG_ENCRYPTION_KEY: randomBytes(16).toString('hex') },
        { AUTH_CONFIG_ENCRYPTION_KEY: randomBytes(31).toString('base64') },
      ];

      for (const envMap of invalidConfigs) {
        const service = createServiceWithEnv(envMap);
        let caught: unknown;
        try {
          service.encryptSecret('secret');
        } catch (err) {
          caught = err;
        }
        expect(caught).toBeInstanceOf(BusinessError);
        expect((caught as BusinessError).code).toBe('ENCRYPTION_KEY_MISSING');
        expect((caught as BusinessError).httpStatus).toBe(
          HttpStatus.BAD_REQUEST,
        );
      }
    });
  });

  describe('mergeSecrets', () => {
    it('should throw BusinessError ENCRYPTION_KEY_MISSING when incoming has non-empty secret and key is missing or invalid', () => {
      const emptyKeyService = createServiceWithEnv({
        AUTH_CONFIG_ENCRYPTION_KEY: '',
      });
      const shortKeyService = createServiceWithEnv({
        AUTH_CONFIG_ENCRYPTION_KEY: randomBytes(16).toString('hex'),
      });

      for (const service of [emptyKeyService, shortKeyService]) {
        let caught: unknown;
        try {
          service.mergeSecrets({}, { clientSecret: 'new-secret' });
        } catch (err) {
          caught = err;
        }
        expect(caught).toBeInstanceOf(BusinessError);
        expect((caught as BusinessError).code).toBe('ENCRYPTION_KEY_MISSING');
        expect((caught as BusinessError).httpStatus).toBe(
          HttpStatus.BAD_REQUEST,
        );
      }
    });

    it('should preserve existing ciphertext on empty string, null, or undefined and remove clearKeys', () => {
      const service = createServiceWithEnv({
        AUTH_CONFIG_ENCRYPTION_KEY: makeHexKey(),
      });

      const initial = service.mergeSecrets(
        {},
        {
          keepEmpty: 'secret-keep-empty',
          keepNull: 'secret-keep-null',
          keepUndefined: 'secret-keep-undefined',
          toRotate: 'old-secret',
          toClear: 'secret-to-clear',
        },
      );

      const snapshotBefore = { ...initial };

      const merged = service.mergeSecrets(
        initial,
        {
          keepEmpty: '',
          keepNull: null,
          keepUndefined: undefined,
          toRotate: 'new-secret',
          added: 'brand-new-secret',
          toClear: '',
        },
        ['toClear'],
      );

      // Does not mutate input existing map
      expect(initial).toEqual(snapshotBefore);

      // Preserves exact existing ciphertexts for '', null, undefined
      expect(merged.keepEmpty).toEqual(initial.keepEmpty);
      expect(merged.keepNull).toEqual(initial.keepNull);
      expect(merged.keepUndefined).toEqual(initial.keepUndefined);

      // Rotates & adds non-empty secrets
      expect(service.decryptSecret(merged.toRotate)).toBe('new-secret');
      expect(service.decryptSecret(merged.added)).toBe('brand-new-secret');

      // Removes clearKeys
      expect(merged.toClear).toBeUndefined();
      expect('toClear' in merged).toBe(false);
    });

    it('should preserve existing ciphertext and remove clearKeys even without encryption key when incoming has no non-empty values', () => {
      const encryptor = createServiceWithEnv({
        AUTH_CONFIG_ENCRYPTION_KEY: makeHexKey(),
      });
      const existing = {
        clientSecret: encryptor.encryptSecret('stored-secret'),
        removableSecret: encryptor.encryptSecret('remove-me'),
      };

      const noKeyService = createServiceWithEnv({
        AUTH_CONFIG_ENCRYPTION_KEY: '',
      });

      const merged = noKeyService.mergeSecrets(
        existing,
        { clientSecret: '', ignored: undefined, nil: null },
        ['removableSecret'],
      );

      expect(merged.clientSecret).toEqual(existing.clientSecret);
      expect('removableSecret' in merged).toBe(false);
    });
  });

  describe('CryptoModule', () => {
    it('should provide and export CryptoService via NestJS DI', async () => {
      const moduleRef = await Test.createTestingModule({
        imports: [CryptoModule],
      })
        .overrideProvider(ConfigService)
        .useValue({
          get: jest.fn((key: string) =>
            key === 'AUTH_CONFIG_ENCRYPTION_KEY' ? makeHexKey() : '',
          ),
        })
        .compile();

      const service = moduleRef.get(CryptoService);
      expect(service).toBeInstanceOf(CryptoService);
      expect(service.hasEncryptionKey()).toBe(true);
    });
  });
});
