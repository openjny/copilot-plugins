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

## Distribution

The marketplace catalog is stored at [`.github/plugin/marketplace.json`](.github/plugin/marketplace.json), and each plugin is stored under [`plugins/`](plugins/). Copilot CLI reads the marketplace and plugin sources directly from the repository's `main` branch; no generated marketplace branch is used.

## License

[MIT](LICENSE)
