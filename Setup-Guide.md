# AIClient2API and Claude Code Setup Guide for macOS

This guide provides comprehensive, step-by-step instructions for setting up AIClient2API and integrating it with Claude Code on a new macOS machine. It covers initial system prerequisites, AIClient2API installation and configuration, Claude Code integration, detailed explanations of the fallback and waterfall system, and how to add custom models and providers.

The goal is to enable any user or AI to perfectly replicate and manage this advanced AI proxy setup.

## Table of Contents

1. [Mac Prerequisites and Initial Setup](#1-mac-prerequisites-and-initial-setup)
2. [AIClient2API Installation and Basic Configuration](#2-aiclient2api-installation-and-basic-configuration)
3. [Claude Code Integration](#3-claude-code-integration)
   * [`.claude/settings.local.json`](#32-claude/settingslocaljson)
   * [`.claude/settings.json`](#33-claude/settingsjson)
4. [Fallback and Waterfall System](#4-fallback-and-waterfall-system)
5. [Custom Model and Provider Integration](#5-custom-model-and-provider-integration)
6. [Verification and Troubleshooting](#6-verification-and-troubleshooting)

---

## 1. Mac Prerequisites and Initial Setup

To begin, ensure your macOS system has the necessary development tools installed.

### 1.1 Install Homebrew

Homebrew is a package manager for macOS that simplifies the installation of other software.

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

Follow the on-screen instructions to complete the installation, including adding Homebrew to your PATH.

### 1.2 Install Node.js and npm

AIClient2API is a Node.js application, so you'll need Node.js and its package manager, npm.

```bash
brew install node
```

Verify the installation:
```bash
node -v
npm -v
```

### 1.3 Install Git

Git is essential for cloning repositories. macOS usually comes with Git pre-installed, but it's good to ensure it's up to date.

```bash
brew install git
```

Verify the installation:

```bash
git --version
```

---

## 2. AIClient2API Installation and Basic Configuration

Now, let's get the AIClient2API proxy up and running.

### 2.1 Clone the AIClient2API Repository

Open your terminal and clone the repository:

```bash
git clone https://github.com/justlovemaki/AIClient-2-API.git
```

### 2.2 Navigate to the Project Directory

```bash
cd AIClient-2-API
```

### 2.3 Install Project Dependencies

```bash
npm install
```

### 2.4 Configure Admin Password (Optional but Recommended for Management APIs)

The `AIClient2API` uses a hashed password for its management APIs (e.g., `/api/*`). If you plan to use these, you'll need to set an admin password. The hashed password is stored in `configs/pwd`.

**Note:** The agent discovered that `configs/pwd` contains a PBKDF2 hash (`pbkdf2:salt:hash`). To set or change this, you typically need to use a utility provided by AIClient2API or manually generate a hash. For a new setup, it's often generated upon first configuration or login attempt if not present. Refer to AIClient2API's specific documentation or `npm run help` for details on how to set the admin password securely.

### 2.5 Start the AIClient2API Proxy

To start the proxy service:

```bash
npm start
```

The proxy should now be running, typically on `http://localhost:3000`. You can verify its status by navigating to `http://localhost:3000/provider_health` in your web browser (no authentication required).

---

## 3. Claude Code Integration

This section explains how to configure Claude Code to use your local AIClient2API proxy. This involves setting up specific environment variables in Claude Code's configuration files.

### 3.1 Locate Claude Code Configuration Files

Claude Code uses `settings.local.json` and `settings.json` for configuration. These files are typically located in the `.claude` folder within your project directory (for project-specific settings) or in your home directory (`~/.claude/`) for global settings. For this setup, we assume project-specific configuration.

### 3.2 `.claude/settings.local.json`

Create or edit the `.claude/settings.local.json` file in your project root (`/Users/ilialiston/AIClient-2-API/.claude/settings.local.json`) with the following content:

```json
{
  "env": {
    "ANTHROPIC_API_KEY": "sk-a60f3efdf9b97e63c84ab4a3583f9d1c",
    "ANTHROPIC_BASE_URL": "http://127.0.0.1:3000",
    "ENABLE_EXPERIMENTAL_MCP_CLI": "true"
  }
}
```

**Explanation:**

* **`ANTHROPIC_API_KEY`**: This is a placeholder API key. For local proxy usage, this value acts as a static key that the AIClient2API proxy expects for AI inference calls to its `/v1/*` endpoints. It doesn't necessarily grant direct access to Anthropic's API but serves as a token recognized by your local proxy. You should replace `sk-a60f3efdf9b97e63c84ab4a3583f9d1c` with your actual AIClient2API key if you have configured one, or leave it as is if the proxy is set to accept any key in development.
* **`ANTHROPIC_BASE_URL`**: This crucial setting redirects all Anthropic API requests from Claude Code to your local AIClient2API proxy, running on `http://127.0.0.1:3000`. By default, Claude Code would attempt to call `api.anthropic.com`, but this setting ensures all requests are routed through your local proxy, allowing it to manage different AI models and providers.
* **`ENABLE_EXPERIMENTAL_MCP_CLI`**: Setting this to `true` enables experimental features within the Claude Code CLI, which might be necessary for advanced proxy integrations or specific functionalities you are leveraging with AIClient2API.

### 3.3 `.claude/settings.json`

Create or edit the `.claude/settings.json` file (in the same `.claude` folder) with the following content:

```json
{
  "env": {
    "ANTHROPIC_AUTH_TOKEN": "sk-a60f3efdf9b97e63c84ab4a3583f9d1c",
    "ANTHROPIC_BASE_URL": "http://127.0.0.1:3000",
    "ENABLE_EXPERIMENTAL_MCP_CLI": "true"
  },
  "permissions": {
    "defaultMode": "acceptEdits"
  },
  "model": "sonnet[1m]",
  "theme": "dark"
}
```

**Explanation:**

* **`env`**: This block mirrors the environment variables from `settings.local.json`, ensuring these critical settings are applied within your Claude Code session.
  * **`ANTHROPIC_AUTH_TOKEN`**: Similar to `ANTHROPIC_API_KEY` in `settings.local.json`, this acts as the authentication token Claude Code sends to your local proxy. It's a placeholder for the actual API key that your AIClient2API instance expects.
  * **`ANTHROPIC_BASE_URL`**: This directs Claude Code to send all Anthropic API requests to your local AIClient2API proxy at `http://127.0.0.1:3000`. This is fundamental for routing requests through your custom setup.
  * **`ENABLE_EXPERIMENTAL_MCP_CLI`**: Enabling this allows Claude Code to use experimental CLI features, which might be required for specific functionalities or advanced interactions with your `AIClient2API` setup.
* **`permissions`**: This section configures the default behavior for tool usage within Claude Code.
  * **`defaultMode: "acceptEdits"`**: This setting indicates that by default, Claude Code should automatically accept edits proposed by the AI, streamlining the development process by reducing the need for constant manual approvals for code modifications.
* **`model: "sonnet[1m]"`**: This sets the default model used by Claude Code to "sonnet". This can be overridden on a per-conversation basis using the `/model` command.
* **`theme: "dark"`**: This sets the UI theme of Claude Code to dark mode, a common preference for developers.

---

## 4. Fallback and Waterfall System

The `AIClient2API` is designed with a sophisticated fallback and waterfall system to ensure maximum reliability and optimal utilization of various AI models and providers. This system prioritizes models and providers based on a defined order, exhausting quotas from preferred options before moving to less preferred ones.

### 4.1 Core Concepts

* **Waterfall Order**: A predefined sequence of models, from most preferred to least preferred (e.g., Claude Sonnet 4.6, then Opus 4.7, then Gemini Pro).
* **Quota Exhaustion**: The system attempts to use a model from all available accounts/providers that offer it until its quota is exhausted or an error occurs. Only then does it move to the next model in the waterfall.
* **Provider Pooling**: Multiple accounts/keys for the same provider can be pooled, and the system intelligently selects the healthiest and least-used one.

### 4.2 How it Works (Technical Overview)

The core logic for the fallback and waterfall system resides primarily in `src/providers/provider-pool.js` and `src/services/service-manager.js`, utilizing model definitions from `src/providers/provider-models.js`.

1.  **Model Definition (`src/providers/provider-models.js`)**:
  * This file defines `PROVIDER_MODELS` (predefined models for each provider) and allows for `CONFIG.customModels` to be integrated.
  * It manages `MODEL_PROTOCOL_PREFIX` and `MODEL_PROVIDER` identifiers, categorizing models by their source and protocol.
  * `getAllProviderModels()` combines static and custom model configurations.

2.  **Provider Pool Management (`src/providers/provider-pool.js`)**:
  * The `ProviderPoolManager` class is responsible for tracking the health, usage, and availability of individual provider instances.
  * It maintains `isHealthy`, `errorCount`, `usageCount`, and `lastUsed` statistics for each provider.
  * The `selectProvider` method is the heart of the selection logic. It takes into account:
    * Provider health (e.g., marked unhealthy due to errors or explicit disabling).
    * Concurrency limits and queues.
    * Least Recently Used (LRU) strategy for load balancing within healthy providers.
    * A tie-breaking selection sequence if multiple providers meet criteria.
  * The `selectProviderWithFallback` method (called from `service-manager.js`) implements the waterfall. It uses a `fallbackChain` (defined in your `globalConfig` for AIClient2API) to iterate through alternative provider types if the primary choice fails.
  * A `modelFallbackMapping` can be configured for more granular control, allowing specific models to fallback to different provider types and models.

3.  **Service Orchestration (`src/services/service-manager.js`)**:
  * This file is the main entry point for routing requests.
  * `autoLinkProviderConfigs` automatically discovers and links credential files from the `configs` directory to the `providerPools`. This is crucial for dynamically adding new provider accounts.
  * `initApiService` initializes the `ProviderPoolManager` with the configured providers.
  * `_findProviderForModel` and `_resolveEffectiveRouting` dynamically determine the appropriate provider and model based on the incoming request, considering explicit prefixes (e.g., `/gemini-cli-oauth/v1/chat/completions`) or automatic detection.
  * `getApiServiceWithFallback` is the primary function used to retrieve an AI service, leveraging the `ProviderPoolManager`'s sophisticated selection and fallback logic.

### 4.3 Configuring the Waterfall Order

The waterfall order and fallback chains are typically defined within AIClient2API's configuration. You will need to inspect your `globalConfig` (which might be in a file like `configs/config.js` or `src/config.js`, or dynamically loaded).

**Example Configuration Snippet (Conceptual - specific file location and structure may vary):**

```javascript
// Example: src/config.js or similar
module.exports = {
  // ... other configurations ...
  fallbackChain: [
    { model: 'claude-sonnet-4.6', providers: ['claude-custom-account1', 'claude-custom-account2', 'kiro-api'] },
    { model: 'claude-opus-4.7', providers: ['claude-custom-account1', 'claude-custom-account2'] },
    { model: 'gemini-3.1-pro-high', providers: ['gemini-cli-oauth-account1', 'gemini-cli-oauth-account2', 'antigravity-api'] },
    // ... further fallback models and providers ...
  ],
  modelFallbackMapping: {
    'claude-sonnet-4.6': { default: 'claude-opus-4.7' },
    'gemini-3.1-flash-thinking': { default: 'gemini-3.1-pro-low' }
  }
  // ...
};
```

**Steps to configure/verify:**

1. **Identify Global Configuration**: Locate the main configuration file for your AIClient2API instance (e.g., `src/config.js`, `configs/config.js`, or similar).
2. **Define `fallbackChain`**: Explicitly list your preferred model-provider combinations in the desired waterfall order. Ensure that for each model, all available accounts/providers are listed.
3. **Implement `modelFallbackMapping` (Optional)**: If you need specific models to fall back to other models *directly* within the same provider or across providers, define these mappings.
4. **Add Provider Credentials**: Ensure credential files for all providers and accounts are placed in the `configs` directory (e.g., `configs/gemini-cli-oauth-account1.json`, `configs/claude-custom-account2.json`). The `service-manager.js` will automatically link these.

---

## 5. Custom Model and Provider Integration

One of the powerful features of AIClient2API is its extensibility, allowing you to integrate models and providers not natively listed, such as GitHub Copilot, OpenRouter, or NVIDIA NIM. This typically involves creating or modifying an adapter and updating model definitions.

### 5.1 General Approach for New Providers

To add a new provider and its models, you'll generally follow these steps:

1.  **Identify API Endpoint and Authentication**: Understand how the new service's API works, its base URL, and its authentication mechanism (API key, OAuth, etc.).
2. **Create/Modify an Adapter (`src/providers/adapter.js`)**:
  * Inspect `src/providers/adapter.js`. It contains `ApiServiceAdapter` as an abstract class and concrete implementations for various providers (Gemini, OpenAI, Claude, etc.).
  * If your new provider's API resembles an existing one (e.g., OpenAI-compatible), you might extend or modify an existing adapter.
  * Otherwise, create a new class that extends `ApiServiceAdapter` and implements `generateContent`, `generateContentStream`, `listModels`, and token management methods specific to your new provider.
  * Register your new adapter in the `adapterRegistry` within `adapter.js`.

3. **Update Model Definitions (`src/providers/provider-models.js`)**:
  * Add your new provider's identifier to `MODEL_PROVIDER` in `src/utils/constants.js`.
  * Update the `PROVIDER_MODELS` object in `src/providers/provider-models.js` to include the models supported by your new provider.
  * Alternatively, if you're adding custom models that are not part of the standard `PROVIDER_MODELS`, you can define them in `CONFIG.customModels`. The `provider-models.js` will automatically integrate these. These can be specific models with prefixes like `openrouter:llama-3-8b`.

4. **Provide Credentials**: Place the necessary API keys or authentication tokens for your new provider in the `configs` directory. The `service-manager.js` will auto-link these to the `providerPools`.

5. **Configure Routing/Fallback**: If needed, update your `globalConfig` (e.g., `fallbackChain`, `modelFallbackMapping`) to include your new provider and its models in the routing logic.

### 5.2 Example: Integrating an OpenAI-Compatible Provider (e.g., OpenRouter)

Since OpenRouter often provides an OpenAI-compatible API, the integration would leverage the existing `OpenAIServiceAdapter`.

1. **Credentials**: Create a file in `configs/` (e.g., `configs/openrouter-custom.json`) with your OpenRouter API key:

    ```json
    {
      "apiKey": "sk-or-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
    }
    ```
2. **Model Definition (`src/providers/provider-models.js`)**: You might add `openrouter-custom` to `MODEL_PROVIDER` in `src/utils/constants.js`. Then, in `src/providers/provider-models.js`, you could either add a new entry to `PROVIDER_MODELS` for `openrouter-custom` or define specific OpenRouter models within `CONFIG.customModels`.

    ```javascript
    // Example CONFIG.customModels entry (Conceptual)
    CONFIG.customModels = {
      'openrouter:llama-3-8b': {
        // ... specific configurations for this model ...
        provider: 'openrouter-custom', // Link to your OpenRouter provider
        baseURL: 'https://openrouter.ai/api/v1',
        // ... other settings ...
      }
    };
    ```

3. **Routing (`src/services/service-manager.js`)**: Ensure `_findProviderForModel` and `_resolveEffectiveRouting` can correctly identify and route requests for models prefixed with `openrouter:` to the `openrouter-custom` provider. The `OpenAIServiceAdapter` would then handle the actual API calls.

### 5.3 Example: Integrating NVIDIA NIM (Hypothetical, requires specific adapter)

Integrating a service like NVIDIA NIM would require a dedicated adapter if its API is not compatible with existing ones.

1. **Create `NvidiaNimServiceAdapter`**: In `src/providers/adapter.js`, create a new class:

    ```javascript
    // src/providers/adapter.js
    class NvidiaNimServiceAdapter extends ApiServiceAdapter {
      constructor(config) {
        super(config);
        // Initialize NVIDIA NIM SDK or API client
      }

      async generateContent(payload) {
        // Implement NVIDIA NIM specific API call
      }
      // ... implement other abstract methods ...
    }
    // Register the adapter
    adapterRegistry.set(MODEL_PROVIDER.NVIDIA_NIM, NvidiaNimServiceAdapter);
    ```

2. **Constants**: Add `NVIDIA_NIM` to `MODEL_PROVIDER` in `src/utils/constants.js`.
3. **Model Definitions**: Add NVIDIA NIM models to `PROVIDER_MODELS` or `CONFIG.customModels` in `src/providers/provider-models.js`, linking them to the `NVIDIA_NIM` provider.
4. **Credentials**: Place NVIDIA NIM API keys in `configs/nvidia-nim.json`.

---

## 6. Verification and Troubleshooting

After setting up, it's crucial to verify that everything is working as expected.

### 6.1 Check Proxy Health

Ensure the AIClient2API proxy is running and responding:

```bash
curl http://localhost:3000/provider_health
```

This should return a JSON object detailing the health of all configured providers.

### 6.2 List Available Models

To see what models your proxy is making available:

```bash
curl http://localhost:3000/v1/models -H "Authorization: Bearer YOUR_AIClient2API_KEY"
```

Replace `YOUR_AIClient2API_KEY` with the key configured in your Claude Code `settings.local.json`.

### 6.3 Test Inference with Claude Code

Open Claude Code and try making a request:

```
claude-code chat "Hello, Claude Code, are you connected to AIClient2API?" --model <any_configured_model>
```

Replace `<any_configured_model>` with a model listed by `/v1/models`.

### 6.4 Common Troubleshooting

*   **`401 Unauthorized`**: Check your `ANTHROPIC_API_KEY` in `settings.local.json` and ensure it matches what your AIClient2API expects for inference calls. For management APIs, ensure you've logged in via `/api/login` and are using the dynamic token.
*   **`502/503 Proxy can't reach provider`**: Check the logs of your AIClient2API proxy (`npm start` output) for errors connecting to the upstream AI providers. Verify your API keys for the individual providers are correct and have quota.
*   **`ECONNREFUSED`**: The AIClient2API proxy is likely not running. Ensure you've executed `npm start` in the `AIClient-2-API` directory.
*   **Model not found/incorrect routing**: Review your `globalConfig` for `fallbackChain` and `modelFallbackMapping`. Check `src/providers/provider-models.js` to ensure your models are correctly defined.
*   **Provider not listed in `/provider_health`**: Ensure your provider credential files are correctly placed in the `configs/` directory and have the right format.

---

This comprehensive guide should enable seamless setup and management of your AIClient2API and Claude Code environment.
