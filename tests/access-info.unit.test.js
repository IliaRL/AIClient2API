import { describe, test, expect } from '@jest/globals';

import { buildAccessInfoPayload } from '../src/ui-modules/access-api.js';

describe('buildAccessInfoPayload', () => {
    test('should expose the real public api key and default providers for the access page', () => {
        const currentConfig = {
            REQUIRED_API_KEY: 'sk-live-demo-key',
            DEFAULT_MODEL_PROVIDERS: ['openai-codex-oauth', 'gemini-cli-oauth'],
            PROVIDER_POOLS_FILE_PATH: 'configs/provider_pools.json'
        };

        const providerPoolManager = {
            providerStatus: {
                'openai-codex-oauth': [
                    { config: { uuid: 'codex-1', isHealthy: true, isDisabled: false }, state: {} },
                    { config: { uuid: 'codex-2', isHealthy: false, isDisabled: true }, state: {} }
                ],
                'gemini-cli-oauth': [
                    { config: { uuid: 'gemini-1', isHealthy: true, isDisabled: false }, state: {} }
                ]
            }
        };

        const payload = buildAccessInfoPayload(currentConfig, providerPoolManager);

        expect(payload.apiKey).toBe('sk-live-demo-key');
        expect(payload.hasApiKey).toBe(true);
        expect(payload.defaultProviders).toEqual(['openai-codex-oauth', 'gemini-cli-oauth']);

        const codexSummary = payload.providers.find(item => item.id === 'openai-codex-oauth');
        expect(codexSummary).toEqual(expect.objectContaining({
            totalNodes: 2,
            healthyNodes: 1,
            disabledNodes: 1,
            enabledNodes: 1,
            isDefault: true
        }));

        const geminiSummary = payload.providers.find(item => item.id === 'gemini-cli-oauth');
        expect(geminiSummary).toEqual(expect.objectContaining({
            totalNodes: 1,
            healthyNodes: 1,
            disabledNodes: 0,
            enabledNodes: 1,
            isDefault: true
        }));
    });

    test('should fall back to MODEL_PROVIDER when DEFAULT_MODEL_PROVIDERS is missing', () => {
        const payload = buildAccessInfoPayload({
            REQUIRED_API_KEY: '',
            MODEL_PROVIDER: 'openai-custom,claude-custom'
        }, { providerStatus: {} });

        expect(payload.hasApiKey).toBe(false);
        expect(payload.defaultProviders).toEqual(['openai-custom', 'claude-custom']);
    });
});
