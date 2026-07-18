import { describe, expect, it } from "vitest";
import type { ConnectionConfig } from "@/types/database";
import { connectionCredentialFields, connectionCredentialValues, connectionWithCredentials, connectionWithPrimaryPassword, persistentConnectionConfig } from "./connectionPasswordPersistence";

function connection(overrides: Partial<ConnectionConfig> = {}): ConnectionConfig {
  return {
    id: "connection-1",
    name: "PostgreSQL",
    db_type: "postgres",
    host: "127.0.0.1",
    port: 5432,
    username: "postgres",
    password: "secret",
    remember_password: true,
    ...overrides,
  };
}

describe("connection password persistence", () => {
  it("removes an unremembered primary password without mutating the runtime config", () => {
    const runtime = connection({ remember_password: false });

    const persisted = persistentConnectionConfig(runtime);

    expect(persisted.password).toBe("");
    expect(runtime.password).toBe("secret");
  });

  it("keeps remembered passwords unchanged", () => {
    const runtime = connection();
    expect(persistentConnectionConfig(runtime)).toBe(runtime);
  });

  it("updates the duplicated Nacos authentication password", () => {
    const config = connection({
      db_type: "nacos",
      external_config: {
        serverAddr: "http://127.0.0.1:8085",
        auth: { kind: "usernamePassword", username: "nacos", password: "old-secret" },
      },
    });

    const runtime = connectionWithPrimaryPassword(config, "new-secret");

    expect(runtime.password).toBe("new-secret");
    expect((runtime.external_config as any).auth.password).toBe("new-secret");
    expect((config.external_config as any).auth.password).toBe("old-secret");
    expect(connectionCredentialValues(config).password).toBe("old-secret");

    const legacyTopLevelOnly = connection({
      db_type: "nacos",
      password: "legacy-secret",
      external_config: {
        serverAddr: "http://127.0.0.1:8085",
        auth: { kind: "usernamePassword", username: "nacos", password: "" },
      },
    });
    expect(connectionCredentialValues(legacyTopLevelOnly).password).toBe("legacy-secret");
  });

  it("clears and restores both Redis Sentinel credentials", () => {
    const config = connection({
      db_type: "redis",
      redis_connection_mode: "sentinel",
      redis_sentinel_password: "sentinel-secret",
      remember_password: false,
    });

    const persisted = persistentConnectionConfig(config);
    expect(persisted.password).toBe("");
    expect(persisted.redis_sentinel_password).toBe("");
    expect(connectionCredentialFields(persisted)).toEqual(["password", "redisSentinelPassword"]);

    const runtime = connectionWithCredentials(persisted, { password: "database-secret", redisSentinelPassword: "sentinel-secret" });
    expect(runtime.password).toBe("database-secret");
    expect(runtime.redis_sentinel_password).toBe("sentinel-secret");
  });

  it.each([
    ["token", "mqToken", { token: "token-secret" }],
    ["basic", "mqBasicPassword", { username: "admin", password: "basic-secret" }],
    ["apiKey", "mqApiKeyValue", { header: "Authorization", value: "api-secret" }],
    ["api_key", "mqApiKeyValue", { header: "Authorization", value: "legacy-api-secret" }],
    ["oauth2", "mqOauthClientSecret", { issuerUrl: "https://issuer", clientId: "client", clientSecret: "oauth-secret" }],
  ] as const)("clears and restores MQ %s authentication", (kind, field, authFields) => {
    const config = connection({
      db_type: "mq",
      password: "",
      remember_password: false,
      external_config: { systemKind: "pulsar", adminUrl: "http://127.0.0.1:8080", auth: { kind, ...authFields } },
    });

    const originalCredentials = connectionCredentialValues(config);
    const persisted = persistentConnectionConfig(config);
    expect(connectionCredentialFields(persisted)).toEqual([field]);
    expect(connectionCredentialValues(persisted)[field]).toBe("");

    const runtime = connectionWithCredentials(persisted, { [field]: originalCredentials[field] });
    expect(connectionCredentialValues(runtime)[field]).toBe(originalCredentials[field]);
  });

  it("removes Mongo URI password, syncs its username, and injects a runtime password", () => {
    const config = connection({
      db_type: "mongodb",
      username: "stale-user",
      password: "",
      remember_password: false,
      connection_string: "mongodb://mongo%40user:uri%3Asecret@localhost:27017/app?authSource=admin",
    });

    expect(connectionCredentialValues(config).password).toBe("uri:secret");
    const persisted = persistentConnectionConfig(config);
    expect(persisted.username).toBe("mongo@user");
    expect(persisted.password).toBe("");
    expect(persisted.connection_string).toBe("mongodb://mongo%40user@localhost:27017/app?authSource=admin");

    const runtime = connectionWithPrimaryPassword(persisted, "next:secret");
    expect(runtime.username).toBe("mongo@user");
    expect(runtime.password).toBe("next:secret");
    expect(runtime.connection_string).toBe("mongodb://mongo%40user:next%3Asecret@localhost:27017/app?authSource=admin");
  });

  it("removes an H2 JDBC PASSWORD property and passes the runtime password separately", () => {
    const config = connection({
      db_type: "h2",
      username: "sa",
      password: "h2-secret",
      remember_password: false,
      connection_string: "jdbc:h2:tcp://localhost/test;USER=sa;PASSWORD=h2-secret;MODE=PostgreSQL",
    });

    const persisted = persistentConnectionConfig(config);
    expect(persisted.connection_string).toBe("jdbc:h2:tcp://localhost/test;USER=sa;MODE=PostgreSQL");
    expect(persisted.password).toBe("");

    const runtime = connectionWithPrimaryPassword(persisted, "runtime;h2");
    expect(runtime.password).toBe("runtime;h2");
    expect(runtime.connection_string).toBe("jdbc:h2:tcp://localhost/test;USER=sa;MODE=PostgreSQL");
  });

  it("also removes legacy PWD properties from JDBC connection strings", () => {
    const config = connection({
      db_type: "jdbc",
      driver_profile: "dremio",
      username: "dremio",
      password: "",
      remember_password: false,
      connection_string: "jdbc:dremio:direct=localhost:31010;user=dremio;PWD=legacy-secret;schema=sys",
    });

    expect(connectionCredentialValues(config).password).toBe("legacy-secret");
    const persisted = persistentConnectionConfig(config);
    expect(persisted.connection_string).toBe("jdbc:dremio:direct=localhost:31010;user=dremio;schema=sys");
    const runtime = connectionWithPrimaryPassword(persisted, "runtime;secret");
    expect(runtime.password).toBe("runtime;secret");
    expect(runtime.connection_string).toBe("jdbc:dremio:direct=localhost:31010;user=dremio;schema=sys");
  });

  it("removes embedded credentials from generic JDBC connection strings and uses top-level runtime credentials", () => {
    const config = connection({
      db_type: "jdbc",
      driver_profile: "custom-sqlserver",
      username: "stale",
      password: "",
      remember_password: false,
      connection_string: "jdbc:sqlserver://jdbc-user:uri-secret@localhost:1433;databaseName=app;PWD=property-secret",
    });

    expect(connectionCredentialValues(config).password).toBe("uri-secret");
    const persisted = persistentConnectionConfig(config);
    expect(persisted.username).toBe("jdbc-user");
    expect(persisted.connection_string).toBe("jdbc:sqlserver://jdbc-user@localhost:1433;databaseName=app");

    const runtime = connectionWithPrimaryPassword(persisted, "runtime-secret");
    expect(runtime.password).toBe("runtime-secret");
    expect(runtime.connection_string).toBe("jdbc:sqlserver://jdbc-user@localhost:1433;databaseName=app");
  });

  it("removes and restores Dremio legacy and Arrow Flight SQL passwords", () => {
    const legacy = connection({
      db_type: "jdbc",
      driver_profile: "dremio",
      username: "dremio",
      password: "legacy-secret",
      remember_password: false,
      connection_string: "jdbc:dremio:direct=localhost:31010;user=dremio;password=legacy-secret;schema=sys",
    });
    const persistedLegacy = persistentConnectionConfig(legacy);
    expect(persistedLegacy.connection_string).toBe("jdbc:dremio:direct=localhost:31010;user=dremio;schema=sys");
    const runtimeLegacy = connectionWithPrimaryPassword(persistedLegacy, "runtime;legacy");
    expect(runtimeLegacy.password).toBe("runtime;legacy");
    expect(runtimeLegacy.connection_string).toBe("jdbc:dremio:direct=localhost:31010;user=dremio;schema=sys");

    const arrow = connection({
      db_type: "jdbc",
      driver_profile: "dremio",
      username: "stale",
      password: "",
      remember_password: false,
      connection_string: "jdbc:arrow-flight-sql://flight:arrow-secret@localhost:32010?useEncryption=false",
    });
    const persistedArrow = persistentConnectionConfig(arrow);
    expect(persistedArrow.username).toBe("flight");
    expect(persistedArrow.connection_string).toBe("jdbc:arrow-flight-sql://flight@localhost:32010?useEncryption=false");
    expect(connectionWithPrimaryPassword(persistedArrow, "runtime-arrow").connection_string).toBe("jdbc:arrow-flight-sql://flight:runtime-arrow@localhost:32010?useEncryption=false");
  });

  it.each(["authToken", "auth_token", "auth-token"])("moves a remembered Turso %s URL parameter into the protected password field", (key) => {
    const config = connection({
      db_type: "turso",
      password: "",
      url_params: `mode=primary&${key}=turso%3Asecret&sync=true`,
    });

    expect(connectionCredentialValues(config).password).toBe("turso:secret");
    const persisted = persistentConnectionConfig(config);
    expect(persisted.password).toBe("turso:secret");
    expect(persisted.url_params).toBe("mode=primary&sync=true");
  });

  it("discards a Turso URL parameter token when password persistence is disabled", () => {
    const config = connection({
      db_type: "turso",
      password: "",
      remember_password: false,
      url_params: "?authToken=plaintext-token&mode=primary",
    });

    const persisted = persistentConnectionConfig(config);
    expect(persisted.password).toBe("");
    expect(persisted.url_params).toBe("?mode=primary");
    expect(JSON.stringify(persisted)).not.toContain("plaintext-token");

    const runtime = connectionWithPrimaryPassword(persisted, "one-time-token");
    expect(runtime.password).toBe("one-time-token");
    expect(runtime.url_params).toBe("?mode=primary");
  });
});
