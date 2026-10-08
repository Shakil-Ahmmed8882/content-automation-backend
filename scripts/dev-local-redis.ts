// Temporary local-only dev entry. The committed .env points REDIS_* at the
// managed (Render-internal) instance, which is unreachable from a workstation,
// and its empty REDIS_USER makes node-redis send a 2-argument AUTH that the
// portable Redis 5 dev server rejects. Overriding process.env is not enough
// because src/app/config re-runs dotenv.config(), so patch the resolved config
// object before the server imports it. Delete once .env has local defaults.
import config from "../src/app/config";

const localConfig = config as Record<string, unknown>;
localConfig.redis_user = undefined;
localConfig.redis_password = undefined;
localConfig.redis_host = "127.0.0.1";
localConfig.redis_port = "6379";

import("../src/server");
