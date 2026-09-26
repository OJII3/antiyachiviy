# Yachigravity

A Yachiyo bot for Discord.

This project is an Antigravity port of [Klein (Pi-based)](https://github.com/ojii3/klein).

## Usage

### Setup

Install Bun and authenticate with your Google account. `nix develop` provides Bun and the
Antigravity CLI.

```sh
bun install
nix develop
cp config/yachigravity.example.json config/yachigravity.json
cp .env.example .env # Configure your Discord bot token in .env
```

Set `TYPESAFE_API_KEY` in `.env` for Jev's reply-generation decision.

Jev decides whether a Discord message should receive a reply. Antigravity generates Yachiyo's
character response through the official CLI, and non-empty responses are sent.

### Start

```sh
bun start
```

Each time you run `bun start`, it resumes the previous Antigravity context. To start a new session, run `bun start -- --new` instead.

### Web UI

You can enable the Web UI by setting `features.webui.enabled` in the config. The default address is `http://127.0.0.1:4310`, where you can view logs and Antigravity sessions.

## Highlights

- Chat with Yachiyo on Discord.
- Jev decides whether to generate a reply.
- Gemini models perform very well in Japanese.
- Gemini models are bad at coding, so your Google AI Plus subscription was useless.
- Uses the official Antigravity CLI to generate character responses.

Prompts are based on [tsukumijima/YacchoGPT](https://github.com/tsukumijima/YacchoGPT).

## Future Developments

Most discord features will follow [Klein](https://github.com/ojii3/klein), but other features will not be added.
