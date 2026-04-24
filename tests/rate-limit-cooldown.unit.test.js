import { describe, expect, test } from '@jest/globals';
import { getRateLimitCooldownRecoveryTime } from '../src/utils/common.js';

const NOW = Date.parse('2026-04-22T00:00:00.000Z');

describe('rate-limit cooldown helper', () => {
    test('returns null when cooldown is disabled', () => {
        const recoveryTime = getRateLimitCooldownRecoveryTime(
            { response: { status: 429 } },
            { RATE_LIMIT_COOLDOWN_ENABLED: false, RATE_LIMIT_COOLDOWN_MS: 30000 },
            NOW
        );

        expect(recoveryTime).toBeNull();
    });

    test('returns null for non-429 errors', () => {
        const recoveryTime = getRateLimitCooldownRecoveryTime(
            { response: { status: 400 } },
            { RATE_LIMIT_COOLDOWN_ENABLED: true, RATE_LIMIT_COOLDOWN_MS: 30000 },
            NOW
        );

        expect(recoveryTime).toBeNull();
    });

    test('uses default cooldown when retry-after is absent', () => {
        const recoveryTime = getRateLimitCooldownRecoveryTime(
            { response: { status: 429 } },
            {
                RATE_LIMIT_COOLDOWN_ENABLED: true,
                RATE_LIMIT_COOLDOWN_MS: 30000,
                RATE_LIMIT_COOLDOWN_JITTER_MS: 0
            },
            NOW
        );

        expect(recoveryTime.toISOString()).toBe('2026-04-22T00:00:30.000Z');
    });

    test('uses Retry-After seconds when present', () => {
        const recoveryTime = getRateLimitCooldownRecoveryTime(
            { response: { status: 429, headers: { 'retry-after': '10' } } },
            {
                RATE_LIMIT_COOLDOWN_ENABLED: true,
                RATE_LIMIT_COOLDOWN_MS: 30000,
                RATE_LIMIT_COOLDOWN_JITTER_MS: 0,
                RATE_LIMIT_COOLDOWN_MAX_MS: 300000
            },
            NOW
        );

        expect(recoveryTime.toISOString()).toBe('2026-04-22T00:00:10.000Z');
    });

    test('treats internal error.retryAfter values as milliseconds', () => {
        const recoveryTime = getRateLimitCooldownRecoveryTime(
            { response: { status: 429 }, retryAfter: 60000 },
            {
                RATE_LIMIT_COOLDOWN_ENABLED: true,
                RATE_LIMIT_COOLDOWN_MS: 30000,
                RATE_LIMIT_COOLDOWN_JITTER_MS: 0,
                RATE_LIMIT_COOLDOWN_MAX_MS: 300000
            },
            NOW
        );

        expect(recoveryTime.toISOString()).toBe('2026-04-22T00:01:00.000Z');
    });

    test('caps excessive Retry-After values', () => {
        const recoveryTime = getRateLimitCooldownRecoveryTime(
            { response: { status: 429, headers: { 'retry-after': '9999' } } },
            {
                RATE_LIMIT_COOLDOWN_ENABLED: true,
                RATE_LIMIT_COOLDOWN_MS: 30000,
                RATE_LIMIT_COOLDOWN_JITTER_MS: 0,
                RATE_LIMIT_COOLDOWN_MAX_MS: 60000
            },
            NOW
        );

        expect(recoveryTime.toISOString()).toBe('2026-04-22T00:01:00.000Z');
    });

    test('reads provider retryDelay bodies', () => {
        const recoveryTime = getRateLimitCooldownRecoveryTime(
            {
                response: {
                    status: 429,
                    data: {
                        error: {
                            details: [
                                {
                                    '@type': 'type.googleapis.com/google.rpc.RetryInfo',
                                    retryDelay: '3s'
                                }
                            ]
                        }
                    }
                }
            },
            {
                RATE_LIMIT_COOLDOWN_ENABLED: true,
                RATE_LIMIT_COOLDOWN_MS: 30000,
                RATE_LIMIT_COOLDOWN_JITTER_MS: 0
            },
            NOW
        );

        expect(recoveryTime.toISOString()).toBe('2026-04-22T00:00:03.000Z');
    });
});
