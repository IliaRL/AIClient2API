import { getProviderConfigs, copyToClipboard, showToast, escapeHtml } from './utils.js';
import { getAvailableRoutes } from './routing-examples.js';
import { t } from './i18n.js';

function getElement(id) {
    return document.getElementById(id);
}

function buildProviderConfigMap(supportedProviders) {
    return new Map(getProviderConfigs(supportedProviders).map(config => [config.id, config]));
}

function resolveRouteInfo(providerId, providerName) {
    const routes = getAvailableRoutes();
    let route = routes.find(item => item.provider === providerId);

    if (!route) {
        const baseRoute = routes.find(item => providerId.startsWith(item.provider + '-'));
        route = {
            provider: providerId,
            name: providerName,
            paths: {
                openai: `/${providerId}/v1/chat/completions`,
                claude: `/${providerId}/v1/messages`
            },
            badge: baseRoute?.badge || '',
            badgeClass: baseRoute?.badgeClass || ''
        };
    }

    return route;
}

function getOriginBaseUrl() {
    return window.location.origin;
}

function getFullEndpoint(path) {
    return `${getOriginBaseUrl()}${path}`;
}

function renderDefaultProviders(defaultProviders, configMap) {
    const container = getElement('accessDefaultProviders');
    if (!container) {
        return;
    }

    if (!defaultProviders.length) {
        container.innerHTML = `<div class="access-empty">${escapeHtml(t('access.empty.defaultProviders'))}</div>`;
        return;
    }

    container.innerHTML = defaultProviders.map(providerId => {
        const config = configMap.get(providerId);
        const name = config?.name || providerId;
        const icon = config?.icon || 'fa-server';
        return `
            <span class="access-chip">
                <i class="fas ${escapeHtml(icon)}"></i>
                <span>${escapeHtml(name)}</span>
            </span>
        `;
    }).join('');
}

function renderProviderCards(providers, defaultProviders, configMap) {
    const container = getElement('accessProvidersTable');
    if (!container) {
        return;
    }

    if (!providers.length) {
        container.innerHTML = `<div class="access-empty">${escapeHtml(t('access.empty.providers'))}</div>`;
        return;
    }

    container.innerHTML = providers.map(provider => {
        const config = configMap.get(provider.id);
        const name = config?.name || provider.id;
        const icon = config?.icon || 'fa-server';
        const route = resolveRouteInfo(provider.id, name);
        const openaiPath = route.paths?.openai;
        const claudePath = route.paths?.claude;
        const isDefault = defaultProviders.includes(provider.id);
        const emptyClass = provider.totalNodes === 0 ? 'empty' : '';
        const emptyBadge = provider.totalNodes === 0
            ? `<span class="access-badge empty"><i class="fas fa-circle-exclamation"></i>${escapeHtml(t('access.badges.empty'))}</span>`
            : '';
        const defaultBadge = isDefault
            ? `<span class="access-badge default"><i class="fas fa-thumbtack"></i>${escapeHtml(t('access.badges.default'))}</span>`
            : '';

        return `
            <article class="access-provider-card ${emptyClass}">
                <div class="access-provider-head">
                    <div class="access-provider-name">
                        <i class="fas ${escapeHtml(icon)}"></i>
                        <div>
                            <h4>${escapeHtml(name)}</h4>
                            <div class="access-provider-id">${escapeHtml(provider.id)}</div>
                        </div>
                    </div>
                    <div class="access-provider-badges">
                        ${defaultBadge}
                        ${emptyBadge}
                    </div>
                </div>
                <div class="access-provider-stats">
                    <div class="access-provider-stat">
                        <span>${escapeHtml(t('access.providers.totalNodes'))}</span>
                        <strong>${provider.totalNodes}</strong>
                    </div>
                    <div class="access-provider-stat">
                        <span>${escapeHtml(t('access.providers.healthyNodes'))}</span>
                        <strong>${provider.healthyNodes}</strong>
                    </div>
                    <div class="access-provider-stat">
                        <span>${escapeHtml(t('access.providers.disabledNodes'))}</span>
                        <strong>${provider.disabledNodes}</strong>
                    </div>
                </div>
                <div class="access-endpoints">
                    <div class="access-endpoint-row">
                        <strong>${escapeHtml(t('access.providers.openaiEndpoint'))}</strong>
                        <code>${escapeHtml(openaiPath ? getFullEndpoint(openaiPath) : t('access.empty.endpoint'))}</code>
                        <button type="button" class="btn btn-secondary btn-sm access-copy-btn" data-copy="${escapeHtml(openaiPath ? getFullEndpoint(openaiPath) : '')}">
                            <i class="fas fa-copy"></i>
                            <span>${escapeHtml(t('access.actions.copyEndpoint'))}</span>
                        </button>
                    </div>
                    <div class="access-endpoint-row">
                        <strong>${escapeHtml(t('access.providers.claudeEndpoint'))}</strong>
                        <code>${escapeHtml(claudePath ? getFullEndpoint(claudePath) : t('access.empty.endpoint'))}</code>
                        <button type="button" class="btn btn-secondary btn-sm access-copy-btn" data-copy="${escapeHtml(claudePath ? getFullEndpoint(claudePath) : '')}">
                            <i class="fas fa-copy"></i>
                            <span>${escapeHtml(t('access.actions.copyEndpoint'))}</span>
                        </button>
                    </div>
                </div>
            </article>
        `;
    }).join('');
}

function updateStats(data) {
    const providerGroupsCount = data.providers.length;
    const totalNodesCount = data.providers.reduce((sum, provider) => sum + provider.totalNodes, 0);

    const keyStatus = data.hasApiKey
        ? t('access.stats.keyReady')
        : t('access.stats.keyMissing');

    if (getElement('accessApiKeyStatus')) getElement('accessApiKeyStatus').textContent = keyStatus;
    if (getElement('accessDefaultProvidersCount')) getElement('accessDefaultProvidersCount').textContent = data.defaultProviders.length;
    if (getElement('accessProviderGroupsCount')) getElement('accessProviderGroupsCount').textContent = providerGroupsCount;
    if (getElement('accessTotalNodesCount')) getElement('accessTotalNodesCount').textContent = totalNodesCount;
}

function updateFields(data) {
    const apiKeyField = getElement('accessApiKeyField');
    const baseUrlField = getElement('accessBaseUrlField');

    if (apiKeyField) {
        apiKeyField.value = data.apiKey || '';
        apiKeyField.placeholder = t('access.empty.key');
    }

    if (baseUrlField) {
        baseUrlField.value = getOriginBaseUrl();
    }
}

async function copyFromButton(button) {
    const value = button.getAttribute('data-copy') || '';
    if (!value) {
        showToast(t('common.error'), t('access.copy.missing'), 'error');
        return;
    }

    const copied = await copyToClipboard(value);
    if (copied) {
        showToast(t('common.success'), t('common.copy.success'), 'success');
    } else {
        showToast(t('common.error'), t('common.copy.failed'), 'error');
    }
}

export async function loadAccessInfo() {
    const container = getElement('accessProvidersTable');
    if (container) {
        container.innerHTML = `
            <div class="status-loading">
                <i class="fas fa-spinner fa-spin"></i>
                <span>${escapeHtml(t('common.loading'))}</span>
            </div>
        `;
    }

    try {
        const data = await window.apiClient.get('/access-info');
        const configMap = buildProviderConfigMap(data.supportedProviders || []);

        updateStats(data);
        updateFields(data);
        renderDefaultProviders(data.defaultProviders || [], configMap);
        renderProviderCards(data.providers || [], data.defaultProviders || [], configMap);
    } catch (error) {
        console.error('Failed to load access info:', error);
        if (container) {
            container.innerHTML = `<div class="access-empty">${escapeHtml(error.message || t('common.error'))}</div>`;
        }
        showToast(t('common.error'), t('access.load.failed', { error: error.message }), 'error');
    }
}

export function initAccessManager() {
    const refreshButton = getElement('refreshAccessInfo');
    if (refreshButton && !refreshButton.dataset.bound) {
        refreshButton.addEventListener('click', () => loadAccessInfo());
        refreshButton.dataset.bound = 'true';
    }

    const toggleButton = getElement('toggleAccessApiKey');
    const apiKeyField = getElement('accessApiKeyField');
    if (toggleButton && apiKeyField && !toggleButton.dataset.bound) {
        toggleButton.addEventListener('click', () => {
            const icon = toggleButton.querySelector('i');
            const isPassword = apiKeyField.type === 'password';
            apiKeyField.type = isPassword ? 'text' : 'password';
            if (icon) {
                icon.className = isPassword ? 'fas fa-eye-slash' : 'fas fa-eye';
            }
        });
        toggleButton.dataset.bound = 'true';
    }

    const copyApiKeyButton = getElement('copyAccessApiKey');
    if (copyApiKeyButton && !copyApiKeyButton.dataset.bound) {
        copyApiKeyButton.addEventListener('click', async () => {
            const value = getElement('accessApiKeyField')?.value || '';
            if (!value) {
                showToast(t('common.error'), t('access.copy.missing'), 'error');
                return;
            }

            const copied = await copyToClipboard(value);
            if (copied) {
                showToast(t('common.success'), t('common.copy.success'), 'success');
            } else {
                showToast(t('common.error'), t('common.copy.failed'), 'error');
            }
        });
        copyApiKeyButton.dataset.bound = 'true';
    }

    const copyBaseUrlButton = getElement('copyAccessBaseUrl');
    if (copyBaseUrlButton && !copyBaseUrlButton.dataset.bound) {
        copyBaseUrlButton.addEventListener('click', async () => {
            const value = getElement('accessBaseUrlField')?.value || '';
            const copied = await copyToClipboard(value);
            if (copied) {
                showToast(t('common.success'), t('common.copy.success'), 'success');
            } else {
                showToast(t('common.error'), t('common.copy.failed'), 'error');
            }
        });
        copyBaseUrlButton.dataset.bound = 'true';
    }

    if (!document.body.dataset.accessCopyBound) {
        document.body.addEventListener('click', async event => {
            const button = event.target.closest('.access-copy-btn');
            if (button) {
                await copyFromButton(button);
            }
        });
        document.body.dataset.accessCopyBound = 'true';
    }
}
