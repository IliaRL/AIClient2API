import {
    handleModelListRequest,
    handleContentGenerationRequest,
    API_ACTIONS,
    ENDPOINT_TYPE
} from '../utils/common.js';
import { getProviderPoolManager } from './service-manager.js';
import logger from '../utils/logger.js';
import { GrokApiService } from '../providers/grok/grok-core.js';

/**
 * Handle /v1/embeddings requests - lightweight passthrough
 */
async function handleEmbeddingsRequest(req, res, currentConfig, providerPoolManager) {
    logger.info(`[Embeddings] Handling request, cached=${!!req._cachedBodyString}, provider=${currentConfig.MODEL_PROVIDER}`);
    try {
        const body = await getRequestBody(req);
        const requestedModel = body.model;
        logger.info(`[Embeddings] Body parsed, model=${requestedModel}`);

        if (!requestedModel) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: { message: 'model is required', type: 'invalid_request_error' } }));
            return;
        }

        // Determine provider (model-router may have set MODEL_PROVIDER)
        const provider = currentConfig.MODEL_PROVIDER || 'openai-custom';

        // Get a healthy account from the pool
        const pool = providerPoolManager?.providerPools?.[provider];
        if (!pool || pool.length === 0) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: { message: `No accounts found for provider: ${provider}`, type: 'invalid_request_error' } }));
            return;
        }

        // Skip unhealthy accounts
        const account = pool.find(a => a.isHealthy !== false) || pool[0];
        const baseUrl = account.OPENAI_BASE_URL || account.baseUrl || account.base_url || '';
        const apiKey = account.OPENAI_API_KEY || account.apiKey || account.api_key || '';

        if (!baseUrl || !apiKey) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: { message: 'Account missing baseUrl or apiKey', type: 'invalid_request_error' } }));
            return;
        }

        // Extract actual model name (strip provider prefix)
        const actualModel = requestedModel.includes(':') ? requestedModel.split(':').slice(1).join(':') : requestedModel;

        const targetUrl = baseUrl.replace(/\/+$/, '') + '/embeddings';
        logger.info(`[Embeddings] ${actualModel} → ${provider} (${targetUrl})`);

        const response = await fetch(targetUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({ ...body, model: actualModel })
        });

        const data = await response.json();
        res.writeHead(response.status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data));
    } catch (error) {
        logger.error(`[Embeddings] Error: ${error.message}`);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: error.message, type: 'server_error' } }));
    }
}

/**
 * NVIDIA GenAI 模型映射：model 名称 → genai 路径后缀
 */
const NVIDIA_GENAI_MODEL_MAP = {
    'flux.2-klein-4b': '/genai/black-forest-labs/flux.2-klein-4b',
    'flux-2-klein-4b': '/genai/black-forest-labs/flux.2-klein-4b',
    'flux': '/genai/black-forest-labs/flux.2-klein-4b',
    'flux.1-dev': '/genai/black-forest-labs/flux-dev',
    'flux-dev': '/genai/black-forest-labs/flux-dev',
    'flux-pro': '/genai/black-forest-labs/flux-pro',
};

/**
 * 检查是否为 NVIDIA GenAI 模型，返回 genai 路径后缀
 */
function getNvidiaGenaiPath(modelName) {
    const lower = modelName.toLowerCase();
    // 精确匹配
    if (NVIDIA_GENAI_MODEL_MAP[lower]) return NVIDIA_GENAI_MODEL_MAP[lower];
    // 前缀匹配：flux 相关模型统一走 genai
    if (lower.startsWith('flux') || lower.startsWith('black-forest') || lower.includes('klein')) {
        return '/genai/black-forest-labs/flux.2-klein-4b';
    }
    return null;
}

/**
 * 将 NVIDIA GenAI 响应格式转换为 OpenAI images/generations 格式
 * NVIDIA 返回：{ "artifacts": [{ "image": "<base64>", "seed": 123 }] }
 * OpenAI 返回：{ "data": [{ "b64_json": "<base64>" }] }
 */
function convertNvidiaGenaiToOpenAI(nvidiaResponse, requestedFormat) {
    // NVIDIA GenAI 返回 base64 image
    if (nvidiaResponse.artifacts && nvidiaResponse.artifacts.length > 0) {
        const artifact = nvidiaResponse.artifacts[0];
        const imageBase64 = artifact.image || artifact.base64 || '';
        if (requestedFormat === 'url' || !requestedFormat) {
            // 默认返回 data URL
            return {
                data: [{ url: `data:image/png;base64,${imageBase64}` }],
                seed: artifact.seed
            };
        } else if (requestedFormat === 'b64_json') {
            return {
                data: [{ b64_json: imageBase64 }],
                seed: artifact.seed
            };
        }
    }
    // 如果不认得的格式，原样返回
    return nvidiaResponse;
}

async function handleImageGenerationsRequest(req, res, currentConfig, providerPoolManager) {
    logger.info(`[Images] Handling request, provider=${currentConfig.MODEL_PROVIDER}`);
    try {
        const body = await getRequestBody(req);
        const requestedModel = body.model;

        if (!requestedModel) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: { message: 'model is required', type: 'invalid_request_error' } }));
            return;
        }

        const provider = currentConfig.MODEL_PROVIDER || 'openai-custom';
        const actualModelFull = requestedModel.includes(':') ? requestedModel : `${provider}:${requestedModel}`;
        const actualModel = requestedModel.includes(':') ? requestedModel.split(':').slice(1).join(':') : requestedModel;

        // Grok imagine 模型：使用 WebSocket 生成图片（不走 OpenAI 兼容流程）
        if (actualModel.toLowerCase().includes('grok') && actualModel.toLowerCase().includes('imagine')) {
            const providerKey = requestedModel.includes(':') ? requestedModel.split(':')[0] : provider;
            let grokAccount = null;
            const grokPool = providerPoolManager?.providerPools?.[providerKey];
            if (grokPool && grokPool.length > 0) {
                grokAccount = grokPool.find(a => a.isHealthy !== false) || grokPool[0];
            }
            if (!grokAccount) {
                for (const [poolName, poolEntries] of Object.entries(providerPoolManager?.providerPools || {})) {
                    if (poolName.toLowerCase().includes('grok') && poolEntries.length > 0) {
                        grokAccount = poolEntries.find(a => a.isHealthy !== false) || poolEntries[0];
                        break;
                    }
                }
            }
            if (!grokAccount || !grokAccount.GROK_COOKIE_TOKEN) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: { message: 'No grok account with valid token found', type: 'invalid_request_error' } }));
                return;
            }
            try {
                const grokService = new GrokApiService(grokAccount);
                const result = await grokService._generateAndCollectWS(actualModel, {
                    message: body.prompt || '',
                    n: body.n || 1,
                });
                const images = [];
                for (const cardJson of result.modelResponse?.cardAttachmentsJson || []) {
                    const card = JSON.parse(cardJson);
                    if (card.image?.original) {
                        const dataUrl = card.image.original;
                        const b64Match = dataUrl.match(/^data:image\/[a-z]+;base64,(.+)$/);
                        if (b64Match) {
                            images.push({ b64_json: b64Match[1] });
                        } else {
                            images.push({ url: dataUrl });
                        }
                    }
                }
                if (images.length === 0) {
                    res.writeHead(502, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: { message: 'Grok image generation returned no images', type: 'server_error' } }));
                    return;
                }
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ created: Math.floor(Date.now() / 1000), data: images }));
            } catch (grokError) {
                logger.error(`[Images] Grok imagine error: ${grokError.message}`);
                res.writeHead(502, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: { message: `Grok image generation failed: ${grokError.message}`, type: 'server_error' } }));
            }
            return;
        }

        // 尝试从所有 pool 中找到该模型对应的 provider（支持 model-router 路由后的情况）
        let pool = providerPoolManager?.providerPools?.[provider];
        let account = null;
        let baseUrl = '';
        let apiKey = '';

        if (!pool || pool.length === 0) {
            // fallback：遍历所有 pools 查找
            for (const [poolName, poolEntries] of Object.entries(providerPoolManager?.providerPools || {})) {
                const found = poolEntries.find(a => a.isHealthy !== false);
                if (found) {
                    pool = poolEntries;
                    account = found;
                    baseUrl = account.OPENAI_BASE_URL || account.baseUrl || account.base_url || '';
                    apiKey = account.OPENAI_API_KEY || account.apiKey || account.api_key || '';
                    break;
                }
            }
            if (!account) {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: { message: `No accounts found for provider: ${provider}`, type: 'invalid_request_error' } }));
                return;
            }
        } else {
            account = pool.find(a => a.isHealthy !== false) || pool[0];
            baseUrl = account.OPENAI_BASE_URL || account.baseUrl || account.base_url || '';
            apiKey = account.OPENAI_API_KEY || account.apiKey || account.api_key || '';

            if (!baseUrl || !apiKey) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: { message: 'Account missing baseUrl or apiKey', type: 'invalid_request_error' } }));
                return;
            }
        }

        // 检测 NVIDIA GenAI 模型（flux 等图像生成模型）
        const isNvidiaBaseUrl = baseUrl.includes('nvidia.com') && baseUrl.includes('integrate.api');
        const genaiPath = isNvidiaBaseUrl ? getNvidiaGenaiPath(actualModel) : null;

        let targetUrl, requestBody, useOpenAiFormat = true;

        if (genaiPath) {
            // NVIDIA GenAI 原生格式（域名从 integrate.api → ai.api）
            useOpenAiFormat = false;
            const genaiBaseUrl = baseUrl.replace('integrate.api.nvidia.com', 'ai.api.nvidia.com');
            targetUrl = genaiBaseUrl.replace(/\/+$/, '') + genaiPath;
            // 转换为 NVIDIA GenAI 格式：{ prompt, width, height, seed, steps }
            requestBody = {
                prompt: body.prompt || '',
                width: body.width || 1024,
                height: body.height || 1024,
                seed: body.seed !== undefined ? body.seed : 0,
                steps: body.steps || body.num_inference_steps || 4,
            };
            if (body.guidance_scale) requestBody.guidance_scale = body.guidance_scale;
            logger.info(`[Images] NVIDIA GenAI: ${actualModel} → ${targetUrl}`);
        } else {
            // 标准 OpenAI /images/generations 格式
            targetUrl = baseUrl.replace(/\/+$/, '') + '/images/generations';
            requestBody = { ...body, model: actualModel };
            logger.info(`[Images] ${actualModel} → ${provider} (${targetUrl})`);
        }

        const response = await fetch(targetUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify(requestBody)
        });

        const contentType = response.headers.get('content-type') || 'application/json';

        // 如果是 GenAI 请求，转换响应格式
        if (!useOpenAiFormat) {
            // NVIDIA 可能返回 JSON 或二进制图片
            if (contentType.includes('json')) {
                const data = await response.json();
                const format = body.response_format;
                const converted = response.ok ? convertNvidiaGenaiToOpenAI(data, format) : data;
                res.writeHead(response.status, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(converted));
            } else {
                // 二进制响应（图片直接返回）
                const data = await response.arrayBuffer();
                logger.info(`[Images] NVIDIA GenAI binary response: ${contentType}, ${data.byteLength} bytes`);
                if (response.ok) {
                    // 转 base64 并包装成 OpenAI 格式
                    const b64 = Buffer.from(data).toString('base64');
                    const format = body.response_format;
                    if (format === 'b64_json') {
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ data: [{ b64_json: b64 }] }));
                    } else {
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ data: [{ url: `data:${contentType};base64,${b64}` }] }));
                    }
                } else {
                    res.writeHead(response.status, { 'Content-Type': contentType });
                    res.end(Buffer.from(data));
                }
            }
        } else {
            const data = await response.arrayBuffer();
            res.writeHead(response.status, { 'Content-Type': contentType });
            res.end(Buffer.from(data));
        }
    } catch (error) {
        logger.error(`[Images] Error: ${error.message}`);
        logger.error(`[Images] Stack: ${error.stack}`);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: error.message, type: 'server_error' } }));
    }
}

function getRequestBody(req) {
    if (req._cachedBodyString) {
        try {
            return Promise.resolve(JSON.parse(req._cachedBodyString));
        } catch (e) {
            logger.error(`[getRequestBody] cached body parse failed: ${e.message}, raw=${req._cachedBodyString.substring(0, 200)}`);
            throw e;
        }
    }
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', () => {
            try { resolve(JSON.parse(body || '{}')); }
            catch (e) { reject(new Error('Invalid JSON: ' + e.message)); }
        });
        req.on('error', reject);
    });
}
/**
 * Handle API authentication and routing
 * @param {string} method - The HTTP method
 * @param {string} path - The request path
 * @param {http.IncomingMessage} req - The HTTP request object
 * @param {http.ServerResponse} res - The HTTP response object
 * @param {Object} currentConfig - The current configuration object
 * @param {Object} apiService - The API service instance
 * @param {Object} providerPoolManager - The provider pool manager instance
 * @param {string} promptLogFilename - The prompt log filename
 * @returns {Promise<boolean>} - True if the request was handled by API
 */
export async function handleAPIRequests(method, path, req, res, currentConfig, apiService, providerPoolManager, promptLogFilename) {


    // Route model list requests
    if (method === 'GET') {
        if (path === '/v1/models') {
            await handleModelListRequest(req, res, apiService, ENDPOINT_TYPE.OPENAI_MODEL_LIST, currentConfig, providerPoolManager, currentConfig.uuid);
            return true;
        }
        if (path === '/v1beta/models') {
            await handleModelListRequest(req, res, apiService, ENDPOINT_TYPE.GEMINI_MODEL_LIST, currentConfig, providerPoolManager, currentConfig.uuid);
            return true;
        }
    }

    // Route content generation requests
    if (method === 'POST') {
        if (path === '/v1/chat/completions') {
            await handleContentGenerationRequest(req, res, apiService, ENDPOINT_TYPE.OPENAI_CHAT, currentConfig, promptLogFilename, providerPoolManager, currentConfig.uuid, path);
            return true;
        }
        if (path === '/v1/responses') {
            await handleContentGenerationRequest(req, res, apiService, ENDPOINT_TYPE.OPENAI_RESPONSES, currentConfig, promptLogFilename, providerPoolManager, currentConfig.uuid, path);
            return true;
        }
        const geminiUrlPattern = new RegExp(`/v1beta/models/(.+?):(${API_ACTIONS.GENERATE_CONTENT}|${API_ACTIONS.STREAM_GENERATE_CONTENT})`);
        if (geminiUrlPattern.test(path)) {
            await handleContentGenerationRequest(req, res, apiService, ENDPOINT_TYPE.GEMINI_CONTENT, currentConfig, promptLogFilename, providerPoolManager, currentConfig.uuid, path);
            return true;
        }
        if (path === '/v1/messages') {
            await handleContentGenerationRequest(req, res, apiService, ENDPOINT_TYPE.CLAUDE_MESSAGE, currentConfig, promptLogFilename, providerPoolManager, currentConfig.uuid, path);
            return true;
        }
        if (path === '/v1/embeddings') {
            await handleEmbeddingsRequest(req, res, currentConfig, providerPoolManager);
            return true;
        }
        if (path === '/v1/images/generations') {
            await handleImageGenerationsRequest(req, res, currentConfig, providerPoolManager);
            return true;
        }
    }

    return false;
}

/**
 * Initialize API management features
 * @param {Object} services - The initialized services
 * @returns {Function} - The heartbeat and token refresh function
 */
export function initializeAPIManagement(services) {
    const providerPoolManager = getProviderPoolManager();
    return async function heartbeatAndRefreshToken() {
        logger.info(`[Heartbeat] Server is running. Current time: ${new Date().toLocaleString()}`, Object.keys(services));
        // 循环遍历所有已初始化的服务适配器，并尝试刷新令牌
        // if (getProviderPoolManager()) {
        //     await getProviderPoolManager().performInitialHealthChecks(); // 定期执行健康检查
        // }
        for (const providerKey in services) {
            const serviceAdapter = services[providerKey];
            try {
                // For pooled providers, refreshToken should be handled by individual instances
                // For single instances, this remains relevant
                if (serviceAdapter.config?.uuid && providerPoolManager) {
                    providerPoolManager._enqueueRefresh(serviceAdapter.config.MODEL_PROVIDER, { 
                        config: serviceAdapter.config, 
                        uuid: serviceAdapter.config.uuid 
                    });
                } else {
                    await serviceAdapter.refreshToken();
                }
                // logger.info(`[Token Refresh] Refreshed token for ${providerKey}`);
            } catch (error) {
                logger.error(`[Token Refresh Error] Failed to refresh token for ${providerKey}: ${error.message}`);
                // 如果是号池中的某个实例刷新失败，这里需要捕获并更新其状态
                // 现有的 serviceInstances 存储的是每个配置对应的单例，而非池中的成员
                // 这意味着如果一个池成员的 token 刷新失败，需要找到它并更新其在 poolManager 中的状态
                // 暂时通过捕获错误日志来发现问题，更精细的控制需要在 refreshToken 中抛出更多信息
            }
        }
    };
}

/**
 * Helper function to read request body
 * @param {http.IncomingMessage} req The HTTP request object.
 * @returns {Promise<string>} The request body as string.
 */
export function readRequestBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
        });
        req.on('end', () => {
            resolve(body);
        });
        req.on('error', err => {
            reject(err);
        });
    });
}