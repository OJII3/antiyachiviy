# Yachigravity

A Yachiyo bot for Discord.

This project is an Antigravity port of [Klein (Pi-based)](https://github.com/ojii3/klein).

## Usage

### Setup

Install Bun and authenticate with your Google account. `nix develop` provides Bun, Python,
`uv`, and the Antigravity CLI, then installs the Python SDK environment automatically.

```sh
bun install
nix develop
cp config/yachigravity.example.json config/yachigravity.json
cp .env.example .env # Configure your Discord bot token in .env
```

The default backend is the official Antigravity CLI. The Python SDK backend is available with
`"llm": { "backend": "python-sdk" }`; it requires `GEMINI_API_KEY`. When working outside the
Nix shell, run `uv sync --project python --frozen` before starting the bot.

### Start

```sh
bun start
```

Each time you run `bun start`, it resumes the previous Antigravity context. To start a new session, run `bun start -- --new` instead.

### Web UI

You can enable the Web UI by setting `features.webui.enabled` in the config. The default address is `http://127.0.0.1:4310`, where you can view logs and Antigravity sessions.

## Highlights

- Chat with Yachiyo on Discord.
- Gemini models perform very well in Japanese.
- Gemini models are bad at coding, so your Google AI Plus subscription was useless.
- Uses the official Antigravity CLI as the default backend, with the Python SDK as an optional backend.

Prompts are based on [tsukumijima/YacchoGPT](https://github.com/tsukumijima/YacchoGPT).

## Future Developments

Most discord features will follow [Klein](https://github.com/ojii3/klein), but other features will not be added.
