import { convertData } from '../convert/convert.js';
import { MODEL_PROVIDER } from '../utils/common.js';
import { CONFIG } from '../core/config-manager.js';
import logger from '../utils/logger.js';
// Note: adapter.js is lazy-imported inside fetchModelsFromApi() to break the circular import
// (adapter.js → gemini-core.js → provider-models.js → adapter.js). Without lazy-loading, every
// const at this module scope sits in the TDZ when gemini-core's top-level
// `const GEMINI_MODELS = getStaticProviderModels(...)` runs during the partial-evaluation phase.

// Providers that expose a usable /v1/models endpoint — we'll merge fetched IDs
// into the cached list when present, falling back to the static catalog otherwise.
const MANAGED_MODEL_LIST_PROVIDERS = [
    'openai-custom',
    'openaiResponses-custom',
    'claude-custom',
    'nvidia-nim',
    'github-models'
];

// Module-level static catalog — defined BEFORE the singleton so getStaticProviderModels()
// can resolve at module-import time (e.g. when gemini-core does `const GEMINI_MODELS = ...`).
// Referencing the singleton from a top-level helper hits a TDZ via the circular import chain
// adapter.js → gemini-core.js → provider-models.js.
const STATIC_PROVIDER_MODELS = {
    'gemini-cli-oauth': [
        'gemini-2.5-flash',
        'gemini-2.5-flash-lite',
        'gemini-2.5-pro',
        'gemini-2.5-pro-preview-06-05',
        'gemini-2.5-flash-preview-09-2025',
        'gemini-3-pro-preview',
        'gemini-3-flash-preview',
        'gemini-3.1-pro-preview',
        'gemini-3.1-flash-lite-preview',
    ],
    'gemini-antigravity': [
        'gemini-3-flash',
        'gemini-3.1-pro-high',
        'gemini-3.1-pro-low',
        'gemini-3.1-flash-image',
        'gemini-3-flash-agent',
        'gemini-2.5-flash',
        'gemini-2.5-flash-lite',
        'gemini-2.5-flash-thinking',
        'gemini-claude-sonnet-4-6',
        'gemini-claude-opus-4-6-thinking',
    ],
    'claude-custom': [],
    'claude-kiro-oauth': [
        'claude-haiku-4-5',
        'claude-haiku-4-5-20251001',
        'claude-opus-4-7',
        'claude-opus-4-6',
        'claude-sonnet-4-6',
        'claude-opus-4-5',
        'claude-opus-4-5-20251101',
        'claude-sonnet-4-5',
        'claude-sonnet-4-5-20250929',
    ],
    'openai-custom': [],
    'openaiResponses-custom': [],
    'openai-qwen-oauth': [
        'coder-model',
        'vision-model',
        'qwen3-coder-plus',
        'qwen3-coder-flash',
    ],
    'openai-iflow': [
        'iflow-rome-30ba3b',
        'qwen3-coder-plus',
        'qwen3-max',
        'qwen3-vl-plus',
        'qwen3-max-preview',
        'qwen3-32b',
        'qwen3-235b-a22b-thinking-2507',
        'qwen3-235b-a22b-instruct',
        'qwen3-235b',
        'kimi-k2-0905',
        'kimi-k2',
        'glm-4.6',
        'deepseek-v3.2',
        'deepseek-r1',
        'deepseek-v3',
        'glm-4.7',
        'glm-5',
        'kimi-k2.5',
        'minimax-m2.1',
        'minimax-m2.5',
    ],
    'openai-codex-oauth': [
        'gpt-5.2',
        'gpt-5.3-codex',
        'gpt-5.3-codex-spark',
        'gpt-5.4',
        'gpt-5.4-mini',
        'gpt-5.5',
        'gpt-image-2',
    ],
    'forward-api': [],
    'grok-web': [
        'grok-4.1-mini',
        'grok-4.1-thinking',
        'grok-4.20',
        'grok-4.20-auto',
        'grok-4.20-fast',
        'grok-4.20-expert',
        'grok-4.20-heavy',
        'grok-imagine-1.0',
        'grok-imagine-1.0-edit',
        'grok-imagine-1.0-fast',
        'grok-imagine-1.0-fast-edit',
    ],
    'nvidia-nim': [],
    'github-models': []
};

/**
 * 动态提供商模型管理
 * 用于在运行时获取、缓存和管理不同提供商支持的模型列表
 */
class DynamicProviderModels {
    constructor() {
        // Static catalog lives at module scope (STATIC_PROVIDER_MODELS) so getStaticProviderModels()
        // can resolve without going through the singleton (which would TDZ during circular imports).
        this._staticProviderModels = STATIC_PROVIDER_MODELS;
        this._dynamicProviderModels = {}; // 存储动态获取的模型列表
        // Cache TTL — 6 hours. Provider model catalogs change rarely; a long TTL avoids
        // repeated /v1/models round-trips, especially on slow providers like GitHub Models.
        // Override via DYNAMIC_MODELS_CACHE_TTL_MS env var (milliseconds).
        this._cacheTTL = Number(process.env.DYNAMIC_MODELS_CACHE_TTL_MS) || (6 * 60 * 60 * 1000);
        this._lastFetchTime = {};       // 记录上次获取时间
        this._fetchPromises = {};       // 避免重复获取的 Promise 缓存
    }

    /**
     * 判断一个提供商类型是否使用“托管”模型列表（即可以从 API 动态获取）
     * @param {string} providerType
     * @returns {boolean}
     */
    usesManagedModelList(providerType) {
        // Bug fix: Array.prototype.find returns the match or `undefined` (never `null`),
        // so the previous `!== null` check was always true and every providerType qualified.
        // We genuinely want a membership check here — switch to `.some()`.
        if (!providerType) return false;
        return MANAGED_MODEL_LIST_PROVIDERS.some(baseType =>
            providerType === baseType || providerType.startsWith(baseType + '-')
        );
    }

    /**
     * 规范化模型ID列表，去重并排序
     * @param {Array<string>} models
     * @returns {Array<string>}
     */
    normalizeModelIds(models = []) {
        return [...new Set(
            (Array.isArray(models) ? models : [])
                .filter(model => typeof model === 'string')
                .map(model => model.trim())
                .filter(Boolean)
        )].sort((a, b) => a.localeCompare(b));
    }

    /**
     * 提取模型ID，支持多种响应结构
     * @param {object|Array} modelList - API 返回的模型列表数据
     * @returns {Array<string>}
     */
    extractModelIdsFromListShape(modelList) {
        if (!modelList) {
            return [];
        }

        if (Array.isArray(modelList)) {
            return modelList.map(item => {
                if (typeof item === 'string') return item;
                return item?.id || item?.name || item?.model || null;
            }).filter(Boolean);
        }

        if (Array.isArray(modelList.data)) {
            return modelList.data.map(item => item?.id || item?.name || item?.model || null).filter(Boolean);
        }

        if (Array.isArray(modelList.models)) {
            return modelList.models.map(item => {
                if (typeof item === 'string') return item;
                return item?.id || item?.name || item?.model || null;
            }).filter(Boolean);
        }

        return [];
    }

    /**
     * 从 native list 提取模型 ID，并进行协议转换（如果需要）
     * @param {object|Array} modelList - 原始模型列表
     * @param {string} providerType - 提供商类型
     * @returns {Array<string>}
     */
    extractModelIdsFromNativeList(modelList, providerType) {
        let convertedModelList = modelList;

        // 只有在提供商类型与目标类型协议不同时才尝试转换
        if (providerType !== MODEL_PROVIDER.OPENAI_CUSTOM && !providerType.startsWith(MODEL_PROVIDER.OPENAI_CUSTOM + '-')) {
            try {
                convertedModelList = convertData(modelList, 'modelList', providerType, MODEL_PROVIDER.OPENAI_CUSTOM);
            } catch {
                convertedModelList = modelList;
            }
        }

        const convertedIds = this.normalizeModelIds(this.extractModelIdsFromListShape(convertedModelList));
        if (convertedIds.length > 0) {
            return convertedIds;
        }

        return this.normalizeModelIds(this.extractModelIdsFromListShape(modelList));
    }

    /**
     * 动态获取指定提供商的模型列表
     * @param {string} providerType - 提供商类型
     * @param {object} providerConfig - 提供商配置（包含 API Key 等）
     * @returns {Promise<Array<string>>}
     */
    async fetchModelsFromApi(providerType, providerConfig) {
        // 如果有正在进行的获取请求，等待其完成
        if (this._fetchPromises[providerType]) {
            return this._fetchPromises[providerType];
        }

        // 检查缓存是否有效
        if (this._dynamicProviderModels[providerType] &&
            (Date.now() - this._lastFetchTime[providerType] < this._cacheTTL)) {
            logger.debug(`[DynamicProviderModels] Using cached models for ${providerType}`);
            return this._dynamicProviderModels[providerType];
        }

        logger.info(`[DynamicProviderModels] Fetching models from API for ${providerType}...`);

        const fetchPromise = (async () => {
            try {
                const tempConfig = {
                    ...CONFIG, // 使用全局配置作为基础
                    ...providerConfig, // 覆盖 providerConfig 中的特定设置（如 API Key）
                    MODEL_PROVIDER: providerType // 确保适配器知道当前提供商类型
                };
                // 避免循环引用或不必要的数据
                delete tempConfig.providerPools;
                delete tempConfig.customModels;

                // Lazy-load adapter.js to avoid the circular-import TDZ (see top-of-file note).
                const { getServiceAdapter } = await import('./adapter.js');
                const serviceAdapter = getServiceAdapter(tempConfig);

                if (typeof serviceAdapter.listModels === 'function') {
                    const nativeModels = await serviceAdapter.listModels();
                    const fetchedModels = this.extractModelIdsFromNativeList(nativeModels, providerType);

                    this._dynamicProviderModels[providerType] = fetchedModels;
                    this._lastFetchTime[providerType] = Date.now();
                    logger.info(`[DynamicProviderModels] Successfully fetched ${fetchedModels.length} models for ${providerType}.`);
                    return fetchedModels;
                } else {
                    logger.warn(`[DynamicProviderModels] listModels method not available for ${providerType}.`);
                }
            } catch (error) {
                logger.error(`[DynamicProviderModels] Failed to fetch models for ${providerType}: ${error.message}`);
            } finally {
                // 清除 Promise 缓存
                delete this._fetchPromises[providerType];
            }
            return []; // 获取失败返回空数组
        })();

        this._fetchPromises[providerType] = fetchPromise;
        return fetchPromise;
    }

    /**
     * 获取指定提供商支持的模型列表 (合并静态、动态、自定义配置)
     * @param {string} providerType - 提供商类型
     * @param {object} providerConfig - 提供商配置（主要用于传递 API Key 等给动态获取方法）
     * @returns {Promise<Array<string>>}
     */
    async getProviderModels(providerType, providerConfig = {}) {
        let models = [];

        // 1. 获取静态配置模型
        if (this._staticProviderModels[providerType]) {
            models = [...this._staticProviderModels[providerType]];
        } else {
            // 尝试前缀匹配
            for (const key of Object.keys(this._staticProviderModels)) {
                if (providerType.startsWith(key + '-')) {
                    models = [...this._staticProviderModels[key]];
                    break;
                }
            }
        }

        // 2. 如果是托管模型，尝试动态获取并合并
        if (this.usesManagedModelList(providerType)) {
            const dynamicModels = await this.fetchModelsFromApi(providerType, providerConfig);
            models = [...new Set([...models, ...dynamicModels])];
        }

        // 3. 注入自定义模型 (来自 CONFIG.customModels)
        if (CONFIG.customModels && Array.isArray(CONFIG.customModels)) {
            CONFIG.customModels.forEach(m => {
                const listProvider = getCustomModelListProvider(m);
                if (listProvider && (listProvider === providerType || providerType.startsWith(listProvider + '-'))) {
                    if (!models.includes(m.id)) {
                        models.push(m.id);
                    }
                }
            });
        }

        return this.normalizeModelIds(models);
    }

    /**
     * 获取所有提供商的模型列表
     * @returns {Promise<Object>} 所有提供商的模型映射
     */
    async getAllProviderModels() {
        const allModels = {};

        // 合并静态模型到 allModels
        for (const provider in this._staticProviderModels) {
            allModels[provider] = [...this._staticProviderModels[provider]];
        }

        // 合并动态获取的模型 (如果存在)
        for (const provider in this._dynamicProviderModels) {
            if (allModels[provider]) {
                allModels[provider] = [...new Set([...allModels[provider], ...this._dynamicProviderModels[provider]])];
            } else {
                allModels[provider] = [...this._dynamicProviderModels[provider]];
            }
        }

        // 注入自定义模型
        if (CONFIG.customModels && Array.isArray(CONFIG.customModels)) {
            CONFIG.customModels.forEach(m => {
                const targetProvider = getCustomModelListProvider(m) || 'custom-auto';

                if (!allModels[targetProvider]) {
                    allModels[targetProvider] = [];
                }

                if (!allModels[targetProvider].includes(m.id)) {
                    allModels[targetProvider].push(m.id);
                }
            });
        }

        // 对每个列表进行排序和规范化
        for (const provider in allModels) {
            allModels[provider] = this.normalizeModelIds(allModels[provider]);
        }

        return allModels;
    }
}

// 导出单例
export const dynamicProviderModels = new DynamicProviderModels();

// ===========================================
// 以下是兼容旧代码的导出函数，将内部逻辑委托给 DynamicProviderModels 实例
// ===========================================

/**
 * 获取模型配置元数据
 * @param {string} modelId - 模型 ID 或别名
 * @param {string|null} provider - 自定义模型归属的提供商
 * @returns {Object|null} 模型配置
 */
export function getCustomModelConfig(modelId, provider = null) {
    if (!CONFIG.customModels || !Array.isArray(CONFIG.customModels)) {
        return null;
    }

    let targetProvider = provider && provider !== MODEL_PROVIDER.AUTO ? provider : null;
    let targetModelId = modelId;

    if (typeof modelId === 'string' && modelId.includes(':')) {
        const [prefix, ...modelParts] = modelId.split(':');
        targetProvider = prefix;
        targetModelId = modelParts.join(':');
    }

    if (!targetProvider) {
        return CONFIG.customModels.find(m =>
            !m.provider &&
            (m.id === targetModelId || m.alias === targetModelId)
        ) || null;
    }

    return CONFIG.customModels.find(m =>
        m.provider === targetProvider &&
        (m.id === targetModelId || m.alias === targetModelId)
    ) || null;
}

export function getCustomModelActualProvider(modelConfig) {
    if (!modelConfig) {
        return '';
    }
    if (Object.prototype.hasOwnProperty.call(modelConfig, 'actualProvider')) {
        return modelConfig.actualProvider || '';
    }
    return modelConfig.provider || '';
}

export function getCustomModelListProvider(modelConfig) {
    return modelConfig?.provider || getCustomModelActualProvider(modelConfig);
}

export function customModelMatchesProvider(modelConfig, providerType) {
    const listProvider = getCustomModelListProvider(modelConfig);
    return listProvider === providerType || (listProvider && providerType.startsWith(listProvider + '-'));
}

export function getConfiguredSupportedModels(providerType, providerConfig = {}) {
    if (!dynamicProviderModels.usesManagedModelList(providerType)) {
        return [];
    }

    return dynamicProviderModels.normalizeModelIds(providerConfig?.supportedModels);
}

/**
 * 获取指定提供商类型支持的模型列表 (兼容旧代码，委托给单例)
 * @param {string} providerType - 提供商类型
 * @param {object} providerConfig - 提供商配置
 * @returns {Promise<Array<string>>} 模型列表
 */
export async function getProviderModels(providerType, providerConfig = {}) {
    return dynamicProviderModels.getProviderModels(providerType, providerConfig);
}

/**
 * 获取所有提供商的模型列表 (兼容旧代码，委托给单例)
 * @returns {Promise<Object>} 所有提供商的模型映射
 */
export async function getAllProviderModels() {
    return dynamicProviderModels.getAllProviderModels();
}

// Delegating wrappers — callers (ui-modules/provider-api.js, etc.) import these directly.
// Without them the module fails to load with: "does not provide an export named 'X'".
export function normalizeModelIds(models = []) {
    return dynamicProviderModels.normalizeModelIds(models);
}

export function usesManagedModelList(providerType) {
    return dynamicProviderModels.usesManagedModelList(providerType);
}

export function extractModelIdsFromNativeList(modelList, providerType) {
    return dynamicProviderModels.extractModelIdsFromNativeList(modelList, providerType);
}

export function extractModelIdsFromListShape(modelList) {
    return dynamicProviderModels.extractModelIdsFromListShape(modelList);
}

/**
 * Synchronous static model list lookup for module-load-time callers that can't await
 * (e.g. gemini-core uses GEMINI_MODELS as a top-level const for fast model-prefix checks).
 * Falls back to the static catalog only — does not touch the dynamic cache.
 */
export function getStaticProviderModels(providerType) {
    if (!providerType) return [];
    if (STATIC_PROVIDER_MODELS[providerType]) return [...STATIC_PROVIDER_MODELS[providerType]];
    for (const key of Object.keys(STATIC_PROVIDER_MODELS)) {
        if (providerType.startsWith(key + '-')) return [...STATIC_PROVIDER_MODELS[key]];
    }
    return [];
}

