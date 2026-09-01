import { Config, Effect, Option, Schema } from 'effect';
import { oauthCallbackURL } from '@instantdb/platform';
import { BadArgsError } from '../errors.ts';
import { readInstantConfigFile } from '../util/instantConfig.ts';

const HttpUrl = Schema.URL.pipe(
  Schema.filter(
    (url) =>
      url.protocol === 'http:' ||
      url.protocol === 'https:' ||
      'Expected an HTTP(S) URL',
  ),
);

// Self-hosted defaults
const SELF_HOSTED_API_URI = process.env.INSTANT_CLI_API_URI || 'https://apiinstant.fidscript.com';
const SELF_HOSTED_DASH_URI = process.env.INSTANT_CLI_DASH_URI || 'https://instant.fidscript.com';

export const getBaseUrl = Effect.gen(function* () {
  const setEnv = yield* Config.string('INSTANT_CLI_API_URI').pipe(
    Config.option,
  );
  const dev = yield* Config.boolean('INSTANT_CLI_DEV').pipe(
    Config.withDefault(false),
  );

  if (Option.isSome(setEnv)) {
    return setEnv.value;
  }

  const instantConfig = yield* Effect.tryPromise(readInstantConfigFile);
  if (instantConfig?.apiURI !== undefined) {
    yield* Schema.decodeUnknown(HttpUrl)(instantConfig.apiURI).pipe(
      Effect.mapError(() =>
        BadArgsError.make({
          message:
            'Invalid apiURI in instant.config.ts. Expected a valid HTTP(S) URL.',
        }),
      ),
    );
    return instantConfig.apiURI;
  }

  // Check for self-hosted environment
  const isSelfHosted = process.env.INSTANT_SELF_HOSTED === 'true';
  if (isSelfHosted) {
    return SELF_HOSTED_API_URI;
  }

  return dev ? 'http://localhost:8888' : 'https://api.instantdb.com';
});

export const getOAuthCallbackUrl = getBaseUrl.pipe(
  Effect.map(oauthCallbackURL),
);

export const getDashUrl = Effect.gen(function* () {
  const setEnv = yield* Config.string('INSTANT_CLI_DASH_URI').pipe(
    Config.option,
  );
  const dev = yield* Config.boolean('INSTANT_CLI_DEV').pipe(
    Config.withDefault(false),
  );

  if (Option.isSome(setEnv)) {
    return setEnv.value;
  }

  const instantConfig = yield* Effect.tryPromise(readInstantConfigFile);
  if (instantConfig?.dashURI !== undefined) {
    yield* Schema.decodeUnknown(HttpUrl)(instantConfig.dashURI).pipe(
      Effect.mapError(() =>
        BadArgsError.make({
          message:
            'Invalid dashURI in instant.config.ts. Expected a valid HTTP(S) URL.',
        }),
      ),
    );
    return instantConfig.dashURI;
  }

  // Check for self-hosted environment
  const isSelfHosted = process.env.INSTANT_SELF_HOSTED === 'true';
  if (isSelfHosted) {
    return SELF_HOSTED_DASH_URI;
  }

  return dev ? 'http://localhost:3000' : 'https://instantdb.com';
});
