import type { NodeModule } from '@/App/types.node-module';
import {
  DEFAULT_VALIDATED_GENERATION_CONFIG,
} from './config';

export const validatedGenerationModule: NodeModule = {
  type: 'validated-generation',
  label: 'Validated Generation',
  menuLabel: 'Validated Generation',
  description: 'Run prompt → LLM → JavaScript validation → deterministic quality validation, with five repair retries before failure.',
  icon: 'BadgeCheck',
  color: '#7c3aed',
  menuOrder: 10,
  createConfig: () => ({ ...DEFAULT_VALIDATED_GENERATION_CONFIG }),
};
