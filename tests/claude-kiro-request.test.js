import { execFileSync } from 'child_process';

describe('Kiro CodeWhisperer request conversion', () => {
    test('keeps single-turn user requests out of history', async () => {
        execFileSync(process.execPath, ['--input-type=module', '-e', `
            import { KiroApiService } from './src/providers/claude/claude-kiro.js';

            const service = new KiroApiService();
            const inputMessages = [
                { role: 'user', content: 'hello' }
            ];

            const request = await service.buildCodewhispererRequest(
                inputMessages,
                'claude-opus-4-7',
                null,
                'system prompt'
            );

            if (request.conversationState.history !== undefined) {
                throw new Error('single-turn request unexpectedly has history');
            }

            const content = request.conversationState.currentMessage.userInputMessage.content;
            if (!content.includes('system prompt') || !content.includes('hello')) {
                throw new Error('current message missing expected content');
            }

            if (JSON.stringify(inputMessages) !== JSON.stringify([{ role: 'user', content: 'hello' }])) {
                throw new Error('input messages were mutated');
            }

            process.exit(0);
        `], { cwd: process.cwd(), stdio: 'pipe' });
    });

    test('keeps prior turns in history for multi-turn requests', async () => {
        execFileSync(process.execPath, ['--input-type=module', '-e', `
            import { KiroApiService } from './src/providers/claude/claude-kiro.js';

            const service = new KiroApiService();
            const request = await service.buildCodewhispererRequest(
                [
                    { role: 'user', content: 'first' },
                    { role: 'assistant', content: 'second' },
                    { role: 'user', content: 'third' }
                ],
                'claude-opus-4-7',
                null,
                'system prompt'
            );

            const history = request.conversationState.history;
            if (!Array.isArray(history) || history.length !== 2) {
                throw new Error('multi-turn history length changed');
            }

            if (!history[0].userInputMessage?.content.includes('first')) {
                throw new Error('first user turn missing from history');
            }

            if (history[1].assistantResponseMessage?.content !== 'second') {
                throw new Error('assistant turn missing from history');
            }

            if (request.conversationState.currentMessage.userInputMessage.content !== 'third') {
                throw new Error('current message changed');
            }

            process.exit(0);
        `], { cwd: process.cwd(), stdio: 'pipe' });
    });

    test('shortens Kiro tool names and restores response tool calls', async () => {
        execFileSync(process.execPath, ['--input-type=module', '-e', `
            import { KiroApiService } from './src/providers/claude/claude-kiro.js';

            const service = new KiroApiService();
            const longToolName = 'mcp__claude_ai_Cloudflare_Developer_Platform__hyperdrive_config_delete';
            const request = await service.buildCodewhispererRequest(
                [
                    { role: 'user', content: 'first' },
                    {
                        role: 'assistant',
                        content: [
                            { type: 'tool_use', id: 'toolu_1', name: longToolName, input: { hyperdrive_id: 'abc' } }
                        ]
                    },
                    { role: 'user', content: 'continue' }
                ],
                'claude-opus-4-7',
                [{
                    name: longToolName,
                    description: 'Delete a Hyperdrive configuration',
                    input_schema: {
                        type: 'object',
                        additionalProperties: false,
                        properties: { hyperdrive_id: { type: 'string' } },
                        required: ['hyperdrive_id']
                    }
                }]
            );

            const toolSpec = request.conversationState.currentMessage.userInputMessage.userInputMessageContext.tools[0].toolSpecification;
            if (toolSpec.name.length > 64 || toolSpec.name === longToolName) {
                throw new Error('long tool name was not shortened for Kiro');
            }

            const assistantTool = request.conversationState.history[1].assistantResponseMessage.toolUses[0];
            if (assistantTool.name !== toolSpec.name) {
                throw new Error('assistant history tool_use was not mapped to the Kiro tool name');
            }

            const rawEvent = ':message-typeevent{"name":"' + toolSpec.name + '","toolUseId":"toolu_2","input":"{}","stop":true}';
            const parsed = service.parseEventStreamChunk(rawEvent, request._kiroToolNameMaps);
            if (parsed.toolCalls[0].function.name !== longToolName) {
                throw new Error('Kiro tool name was not restored for Claude response');
            }

            process.exit(0);
        `], { cwd: process.cwd(), stdio: 'pipe' });
    });

    test('marks thinking-only stream responses as max_tokens and emits a minimal text block', async () => {
        execFileSync(process.execPath, ['--input-type=module', '-e', `
            import { KiroApiService } from './src/providers/claude/claude-kiro.js';

            class TestKiroApiService extends KiroApiService {
                constructor() {
                    super();
                    this.isInitialized = true;
                }

                async *streamApiReal() {
                    yield { type: 'content', content: '<thinking>spent the whole budget</thinking>' };
                    yield { type: 'contextUsage', contextUsagePercentage: 1 };
                }
            }

            const service = new TestKiroApiService();
            const events = [];
            for await (const event of service.generateContentStream('claude-opus-4-7', {
                thinking: { type: 'enabled', budget_tokens: 1024 },
                messages: [{ role: 'user', content: 'hello' }]
            })) {
                events.push(event);
            }

            const textDelta = events.find(event =>
                event.type === 'content_block_delta' &&
                event.delta?.type === 'text_delta' &&
                event.delta?.text === ' '
            );
            if (!textDelta) {
                throw new Error('thinking-only stream did not emit the minimal text block');
            }

            const messageDelta = events.find(event => event.type === 'message_delta');
            if (messageDelta?.delta?.stop_reason !== 'max_tokens') {
                throw new Error('thinking-only stream did not use max_tokens stop_reason');
            }

            process.exit(0);
        `], { cwd: process.cwd(), stdio: 'pipe' });
    });

    test('marks thinking-only non-stream responses as max_tokens', async () => {
        execFileSync(process.execPath, ['--input-type=module', '-e', `
            import { KiroApiService } from './src/providers/claude/claude-kiro.js';

            const service = new KiroApiService();
            const response = service.buildClaudeResponse(
                [{ type: 'thinking', thinking: 'spent the whole budget' }],
                false,
                'assistant',
                'claude-opus-4-7',
                null,
                10
            );

            if (response.stop_reason !== 'max_tokens') {
                throw new Error('thinking-only non-stream response did not use max_tokens stop_reason');
            }
            if (!response.content.some(block => block.type === 'text' && block.text === ' ')) {
                throw new Error('thinking-only non-stream response did not include a minimal text block');
            }

            process.exit(0);
        `], { cwd: process.cwd(), stdio: 'pipe' });
    });
});
