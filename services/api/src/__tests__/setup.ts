/**
 * Test setup file — runs before all tests.
 *
 * Sets test environment variables so tests don't need a real .env file.
 * These are safe dummy values for testing only.
 */

// Set test environment variables BEFORE any module imports
process.env['NODE_ENV'] = 'test';
process.env['PORT'] = '3001';  // Must be > 0 for Zod validation
process.env['DATABASE_URL'] = process.env['DATABASE_URL'] || 'postgresql://nari_user:test_password@localhost:5432/nari_test';
process.env['REDIS_URL'] = process.env['REDIS_URL'] || 'redis://localhost:6379';
process.env['JWT_SECRET'] = 'test_jwt_secret_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
process.env['JWT_REFRESH_SECRET'] = 'test_refresh_secret_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
process.env['LOG_LEVEL'] = 'error';  // Valid Zod enum, keeps tests quiet
process.env['LOG_PRETTY'] = 'false';
process.env['CORS_ORIGINS'] = 'http://localhost:3000';
process.env['SMS_PROVIDER'] = 'mock';
process.env['STORAGE_PROVIDER'] = 'minio';
