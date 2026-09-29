# Your Anthropic API key

Agent Crew runs Claude with **your own** Anthropic API key, so you pay Anthropic directly for what the crew uses.

1. Open [console.anthropic.com](https://console.anthropic.com/settings/keys) and create a key.
2. Run **Crew: Set API Key** and paste it.

The key is stored in your operating system's keychain through VS Code SecretStorage. It never appears in settings, logs or the chat view. Remove it any time with **Crew: Clear API Key**.

Spending is capped per project by `crew.budgetCapUsd` (default $20).
