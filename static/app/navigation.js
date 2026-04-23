// 导航功能模块

import { elements } from './constants.js';

/**
 * 初始化导航功能
 */
function initNavigation() {
    if (!elements.navItems || !elements.sections) {
        console.warn('导航元素未找到');
        return;
    }

    elements.navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            activateSection(item.dataset.section, { updateHash: true });
        });
    });

    window.addEventListener('hashchange', () => {
        const sectionId = window.location.hash.slice(1);
        if (sectionId) {
            activateSection(sectionId, { updateHash: false });
        }
    });

    const initialSectionId = window.location.hash.slice(1);
    if (initialSectionId) {
        activateSection(initialSectionId, { updateHash: false });
    }
}

/**
 * 激活指定章节
 * @param {string} sectionId - 章节ID
 * @param {Object} options - 额外选项
 */
function activateSection(sectionId, options = {}) {
    const { updateHash = false } = options;
    const hasMatchingSection = Array.from(elements.sections).some(section => section.id === sectionId);

    if (!hasMatchingSection) {
        return;
    }

    // 更新导航状态
    elements.navItems.forEach(nav => {
        nav.classList.remove('active');
        if (nav.dataset.section === sectionId) {
            nav.classList.add('active');
        }
    });

    // 显示对应章节
    elements.sections.forEach(section => {
        section.classList.remove('active');
        if (section.id === sectionId) {
            section.classList.add('active');
            
            // 如果是日志页面，默认滚动到底部
            if (sectionId === 'logs') {
                setTimeout(() => {
                    const logsContainer = document.getElementById('logsContainer');
                    if (logsContainer) {
                        logsContainer.scrollTop = logsContainer.scrollHeight;
                    }
                }, 100);
            }
        }
    });

    // 滚动到顶部
    scrollToTop();

    if (updateHash && window.location.hash !== `#${sectionId}`) {
        window.location.hash = sectionId;
    }

    if (sectionId === 'access' && typeof window.loadAccessInfo === 'function') {
        window.loadAccessInfo();
    }
}

/**
 * 切换到指定章节
 * @param {string} sectionId - 章节ID
 */
function switchToSection(sectionId) {
    activateSection(sectionId, { updateHash: true });
}

/**
 * 滚动到页面顶部
 */
function scrollToTop() {
    // 尝试滚动内容区域
    const contentContainer = document.getElementById('content-container');
    if (contentContainer) {
        contentContainer.scrollTop = 0;
    }
    
    // 同时滚动窗口到顶部
    window.scrollTo(0, 0);
}

/**
 * 切换到仪表盘页面
 */
function switchToDashboard() {
    switchToSection('dashboard');
}

/**
 * 切换到提供商页面
 */
function switchToProviders() {
    switchToSection('providers');
}

export {
    initNavigation,
    switchToSection,
    switchToDashboard,
    switchToProviders
};
