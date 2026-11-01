# companion-module-netron-en

See [HELP.md](companion/HELP.md) and LICENSE

## Development

Requires Node 26 and Yarn 4 (via corepack). With [mise](https://mise.jdx.dev), `mise install` sets up the right Node version.

```sh
yarn install
yarn test      # run the test suite
yarn package   # build the module package (.tgz) for Companion
```

### Tests

Tests use Node's built-in test runner and run against a fake Netron EN-12 web server
(`test/helpers/fake-en.js`) that mimics the real device's endpoints, including its quirks
(case-sensitive URLs, padded responses). The fake device can be made slow, unreachable, or
unresponsive, and records every request so tests can check exactly what the module sends.

Most importantly, the tests guard against overloading the device: the module must never have
more than one request in progress, must time out hung requests, must back off when the device
is down, and must stay quiet when idle.
