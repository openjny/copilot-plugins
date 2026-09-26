# openjny Copilot plugins

Public Agent Plugins 1.0 plugins for GitHub Copilot, distributed from the `main` branch.

## Register the marketplace

```shell
copilot plugin marketplace add openjny/copilot-plugins
```

Browse the available plugins:

```shell
copilot plugin marketplace browse openjny
```

## Install a plugin

```shell
copilot plugin install council@openjny
copilot plugin install grilling@openjny
copilot plugin install standard-ai-sdlc-repo@openjny
copilot plugin install zoom-out@openjny
```

List installed plugins:

```shell
copilot plugin list
```

## Available plugins

| Plugin | Description |
|:--|:--|
| [`council`](plugins/council/) | Aggregates responses from multiple LLM models to reach a conclusion on complex or multi-perspective problems. |
| [`grilling`](plugins/grilling/) | Relentlessly interviews the user to stress-test a plan or design before implementation. |
| [`standard-ai-sdlc-repo`](plugins/standard-ai-sdlc-repo/) | Sets up or reviews a standard repository for AI-assisted software development with the essential files, documentation, governance, and agent context. |
| [`zoom-out`](plugins/zoom-out/) | Steps back from the immediate details to map the broader context, big picture, higher-level purpose, and relationships. |

## Distribution

The marketplace catalog is stored at [`.github/plugin/marketplace.json`](.github/plugin/marketplace.json), and each plugin is stored under [`plugins/`](plugins/). Copilot CLI reads the marketplace and plugin sources directly from the repository's `main` branch; no generated marketplace branch is used.

## License

[MIT](LICENSE)
