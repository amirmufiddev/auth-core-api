export class CacheScopeMissingError extends Error {
  constructor(scope: 'tenant' | 'organization') {
    super('CacheScopeMissingError');
    this.name = 'CacheScopeMissingError';
    this.scope = scope;
  }

  readonly scope: 'tenant' | 'organization';
}