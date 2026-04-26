import {
    handleModelListRequest,
    handleContentGenerationRequest,
    API_ACTIONS,
    ENDPOINT_TYPE,
    getRequestBody
} from '../utils/common.js';
import { getProviderPoolManager, getApiServiceWithFallback } from './service-manager.js';
import logger from '../utils/logger.js';
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

    // Route image generation requests
    if (method === 'POST' && path === '/v1/images/generations') {
        await handleImageGenerationRequest(req, res, currentConfig, providerPoolManager);
        return true;
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
 * Handle POST /v1/images/generations - OpenAI 标准生图接口
 */
async function handleImageGenerationRequest(req, res, currentConfig, providerPoolManager) {
    try {
        const body = await getRequestBody(req);
        const { model = 'gpt-image-2', prompt, n = 1, response_format = 'b64_json' } = body;

        if (!prompt) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: { message: 'prompt is required', type: 'invalid_request_error', code: 'invalid_request_error' } }));
            return;
        }

        // 构造 Codex 格式请求，prepareRequestBody 会自动处理 gpt-image-2 → gpt-5.4 + image_generation tool
        const codexRequestBody = {
            model,
            input: [{
                type: 'message',
                role: 'user',
                content: [{ type: 'input_text', text: prompt }]
            }]
        };

        // 从号池获取服务实例
        const shouldUsePool = providerPoolManager && currentConfig.providerPools;
        const result = await getApiServiceWithFallback(currentConfig, model, { acquireSlot: !!shouldUsePool });
        const service = result.service;

        if (!service) {
            res.writeHead(503, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: { message: 'No service available for image generation', type: 'server_error' } }));
            return;
        }

        logger.info(`[Image Generation] model=${model}, n=${n}, response_format=${response_format}`);

        // 发起请求（generateContent 内部已经是 SSE 解析，返回 completedEvent）
        const imageRequests = [];
        for (let i = 0; i < Math.max(1, n); i++) {
            imageRequests.push(service.generateContent(model, { ...codexRequestBody }));
        }
        const completedEvents = await Promise.all(imageRequests);

        // 从 response.output 中提取 image_generation_call 结果
        const data = [];
        for (const completedEvent of completedEvents) {
            const output = completedEvent?.response?.output || [];
            for (const item of output) {
                if (item.type === 'image_generation_call' && item.result) {
                    if (response_format === 'url') {
                        data.push({ url: `data:image/${item.output_format || 'png'};base64,${item.result}` });
                    } else {
                        data.push({ b64_json: item.result });
                    }
                }
            }
        }

        if (data.length === 0) {
            logger.error('[Image Generation] No image found in response output');
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: { message: 'Image generation failed: no image in response', type: 'server_error' } }));
            return;
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ created: Math.floor(Date.now() / 1000), data }));
    } catch (error) {
        logger.error('[Image Generation] Error:', error.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: error.message, type: 'server_error' } }));
    }
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