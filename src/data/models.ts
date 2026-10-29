export interface CuratedModel {
	id: string
	name: string
}

export interface CuratedModelGroup {
	provider: string
	models: CuratedModel[]
}

/** Public OpenRouter catalogue used at build time and by the refresh script. */
export const CATALOGUE_URL = 'https://openrouter.ai/api/v1/models'

/**
 * The calculator deliberately exposes a small, curated selection rather than
 * the full OpenRouter catalogue. Keep this list in sync with the fallback
 * snapshot by running `npm run pricing:refresh`.
 */
export const CURATED_GROUPS: CuratedModelGroup[] = [
	{
		provider: 'DeepSeek',
		models: [
			{
				id: 'deepseek/deepseek-v4.1-flash-1017',
				name: 'DeepSeek V4.1 Flash 1017',
			},
			{
				id: 'deepseek/deepseek-v4-pro-0813',
				name: 'DeepSeek V4 Pro 0813',
			},
		],
	},
	{
		provider: 'Z.ai',
		models: [{ id: 'z-ai/glm-5.3-flash', name: 'GLM 5.3 Flash' }],
	},
	{
		provider: 'OpenAI',
		models: [
			{ id: 'openai/gpt-6-luna', name: 'GPT-6 Luna' },
			{ id: 'openai/gpt-6-sol', name: 'GPT-6 Sol' },
			{ id: 'openai/gpt-6.1-sol', name: 'GPT-6.1 Sol' },
			{ id: 'openai/gpt-6-astra', name: 'GPT-6 Astra' },
		],
	},
	{
		provider: 'Anthropic',
		models: [
			{ id: 'anthropic/claude-fable-5.1', name: 'Claude Fable 5.1' },
			{ id: 'anthropic/claude-haiku-5.5', name: 'Claude Haiku 5.5' },
			{ id: 'anthropic/claude-sonnet-5.5', name: 'Claude Sonnet 5.5' },
			{ id: 'anthropic/claude-opus-5.5', name: 'Claude Opus 5.5' },
		],
	},
]

export const DEFAULT_MODEL_ID = 'deepseek/deepseek-v4.1-flash-1017'
export const CUSTOM_MODEL_ID = 'custom'

export const CUSTOM_MODEL: CuratedModel = {
	id: CUSTOM_MODEL_ID,
	name: 'Custom model',
}

export const CURATED_MODEL_IDS = CURATED_GROUPS.flatMap((group) =>
	group.models.map((model) => model.id)
)
