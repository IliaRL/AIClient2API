/**
 * Model Router 插件 - 自定义模型别名路由
 *
 * 功能：
 * - 将自定义模型别名映射到 provider:model 格式
 * - 支持热编辑（通过 API 或配置文件）
 * - 支持 /plugin/model-router/ 路径查看和编辑映射规则
 *
 * 原理：
 * - 作为 middleware 插件，在请求处理最早期拦截
 * - 读取 body，匹配别名，改写 model 字段和 MODEL_PROVIDER
 * - 将处理后的 body 缓存到 req._cachedBody 供下游使用
 */

import logger from '../../utils/logger.js';
import { promises as fs } from 'fs';
import path from 'path';

const CONFIG_FILE = path.join(process.cwd(), 'src', 'plugins', 'model-router', 'config.json');

/**
 * 加载映射配置
 */
async function loadMappings() {
    try {
        const content = await fs.readFile(CONFIG_FILE, 'utf8');
        const config = JSON.parse(content);
        return config.mappings || {};
    } catch (error) {
        logger.error(`[ModelRouter] Failed to load config: ${error.message}`);
        return {};
    }
}

/**
 * 保存映射配置
 */
async function saveMappings(mappings) {
    const config = { mappings };
    await fs.writeFile(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
}

/**
 * 匹配模型别名
 * 优先级：精确匹配 > 不区分大小写 > 包含匹配
 */
function matchAlias(requestedModel, mappings) {
    const lower = requestedModel.toLowerCase();

    // 1. 精确匹配
    if (mappings[requestedModel]) return mappings[requestedModel];

    // 2. 不区分大小写
    for (const [alias, rule] of Object.entries(mappings)) {
        if (alias.toLowerCase() === lower) return rule;
    }

    // 3. 包含匹配
    for (const [alias, rule] of Object.entries(mappings)) {
        if (lower.includes(alias.toLowerCase()) || alias.toLowerCase().includes(lower)) {
            return rule;
        }
    }

    return null;
}

/**
 * 读取完整的 request body 并缓存
 */
function readFullBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        req.on('data', chunk => chunks.push(chunk));
        req.on('end', () => resolve(Buffer.concat(chunks)));
        req.on('error', reject);
    });
}

/**
 * Monkey-patch getRequestBody 以支持缓存的 body
 */
function patchGetRequestBody() {
    const commonModuleUrl = new URL('../../utils/common.js', import.meta.url);
    import(commonModuleUrl).then(common => {
        // 保存原始函数引用（通过重新导入）
        // 由于 ESM 的 export 是只读的，我们用另一种方式
    }).catch(() => {});
}

const modelRouterPlugin = {
    name: 'model-router',
    version: '1.0.0',
    description: '模型别名路由插件 - 将自定义模型名映射到 provider:model<br>管理：<a href="/plugin/model-router/" target="_blank">model-router 管理面板</a>',
    type: 'middleware',
    _priority: 1, // 最高优先级，最先执行

    async init(config) {
        // Monkey-patch getRequestBody to support cached body from this plugin
        try {
            const common = await import('../../utils/common.js');
            const origFn = common.getRequestBody;
            // We can't directly reassign ESM exports, but we can wrap the module
            // Instead, we'll patch it at runtime by modifying the imported reference
            // The trick: store the patched version on req for downstream to use
            // Actually, the simplest approach: we make getRequestBody check req._cachedBodyString
        } catch (e) {
            logger.warn(`[ModelRouter] Init warning: ${e.message}`);
        }
        logger.info('[ModelRouter] Plugin initialized');
    },

    /**
     * 中间件：拦截请求，改写模型名
     */
    async middleware(req, res, requestUrl, config) {
        if (req.method !== 'POST') return null;

        const pathName = requestUrl.pathname;
        const isApiRequest = pathName.includes('/chat/completions') ||
                           pathName.includes('/embeddings') ||
                           pathName.includes('/images/generations') ||
                           pathName.includes('/responses') ||
                           pathName.includes('/messages') ||
                           pathName.includes('/generateContent');

        if (!isApiRequest) return null;

        // 如果已经被本插件处理过，跳过
        if (req._modelRouterProcessed) return null;
        req._modelRouterProcessed = true;

        // 读取完整 body
        let rawBody;
        try {
            rawBody = await readFullBody(req);
        } catch (e) {
            return null;
        }

        let body;
        try {
            body = JSON.parse(rawBody.toString() || '{}');
        } catch (e) {
            return null;
        }

        const requestedModel = body.model;
        if (!requestedModel) {
            // 不改写，但需要让 body 可被下游重新读取
            req._cachedBodyBuffer = rawBody;
            req._cachedBodyString = rawBody.toString();
            return null;
        }

        // 已经是 provider:model 格式且有对应号池，跳过
        if (requestedModel.includes(':')) {
            const prefix = requestedModel.split(':')[0];
            if (config.providerPools?.[prefix]) {
                req._cachedBodyBuffer = rawBody;
                req._cachedBodyString = rawBody.toString();
                return null;
            }
        }

        // 匹配别名
        const mappings = await loadMappings();
        const rule = matchAlias(requestedModel, mappings);

        let finalBodyString = rawBody.toString();

        if (rule && rule.target) {
            logger.info(`[ModelRouter] "${requestedModel}" → "${rule.target}" (${rule.description || ''})`);

            body.model = rule.target;
            finalBodyString = JSON.stringify(body);

            // 设置 MODEL_PROVIDER
            const [provider] = rule.target.split(':');
            if (provider) {
                config.MODEL_PROVIDER = provider;
            }
        }

        // 缓存 body 供下游读取
        req._cachedBodyBuffer = Buffer.from(finalBodyString);
        req._cachedBodyString = finalBodyString;

        return null;
    },

    /**
     * API 路由：查看和编辑映射规则
     */
    routes: [
        {
            method: 'GET',
            path: '/plugin/model-router/',
            handler: async (method, pathUrl, req, res) => {
                try {
                    const htmlPath = path.join(process.cwd(), 'src', 'plugins', 'model-router', 'static', 'index.html');
                    const html = await fs.readFile(htmlPath, 'utf8');
                    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                    res.end(html);
                } catch (e) {
                    res.writeHead(500, { 'Content-Type': 'text/plain' });
                    res.end('Plugin page not found');
                }
                return true;
            }
        },
        {
            method: 'GET',
            path: '/plugin/model-router/api/mappings',
            handler: async (method, pathUrl, req, res) => {
                const mappings = await loadMappings();
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true, mappings }, null, 2));
                return true;
            }
        },
        {
            method: 'PUT',
            path: '/plugin/model-router/api/mappings',
            handler: async (method, pathUrl, req, res) => {
                try {
                    const bodyBuffer = await readFullBody(req);
                    const body = JSON.parse(bodyBuffer.toString());

                    const { alias, target, description } = body;
                    if (!alias || !target) {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: false, error: 'alias and target are required' }));
                        return true;
                    }

                    const mappings = await loadMappings();
                    mappings[alias] = { target, description: description || '' };
                    await saveMappings(mappings);

                    logger.info(`[ModelRouter] Mapping added: ${alias} → ${target}`);
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: true, mappings }));
                    return true;
                } catch (error) {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, error: error.message }));
                    return true;
                }
            }
        },
        {
            method: 'DELETE',
            path: '/plugin/model-router/api/mappings',
            handler: async (method, pathUrl, req, res) => {
                try {
                    const bodyBuffer = await readFullBody(req);
                    const body = JSON.parse(bodyBuffer.toString());

                    const { alias } = body;
                    if (!alias) {
                        res.writeHead(400, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ success: false, error: 'alias is required' }));
                        return true;
                    }

                    const mappings = await loadMappings();
                    if (mappings[alias]) {
                        delete mappings[alias];
                        await saveMappings(mappings);
                        logger.info(`[ModelRouter] Mapping deleted: ${alias}`);
                    }

                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: true, mappings }));
                    return true;
                } catch (error) {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ success: false, error: error.message }));
                    return true;
                }
            }
        }
    ]
};

export default modelRouterPlugin;
