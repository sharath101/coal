import type { AppConfig } from '../../core/config';
import { AnthropicProvider } from './anthropic';
import { CopilotProvider } from './copilot';
import type { AiProvider } from './provider';

/** The provider the settings name, or none when the AI isn't set up (the endpoints then say so). */
export function createProvider(config: AppConfig): AiProvider | null {
  const { ai } = config;
  switch (ai.provider) {
    case 'anthropic':
      return ai.anthropic.apiKey ? new AnthropicProvider(ai.anthropic) : null;
    case 'copilot':
      return ai.copilotToken ? new CopilotProvider(ai.copilotToken) : null;
    case 'none':
      return null;
  }
}
