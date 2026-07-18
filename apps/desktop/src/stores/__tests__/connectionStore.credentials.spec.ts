import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectionConfig } from "@/types/database";

function installLocalStorage() {
  const data = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: vi.fn((key: string) => data.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => data.set(key, value)),
    removeItem: vi.fn((key: string) => data.delete(key)),
  });
}

describe("connectionStore unremembered credentials", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    installLocalStorage();
    setActivePinia(createPinia());
  });

  it("prompts for a transient password without adding it back to the saved config", async () => {
    const connection: ConnectionConfig = {
      id: "mongo-transient-password",
      name: "MongoDB without saved password",
      db_type: "mongodb",
      driver_profile: "mongodb",
      host: "127.0.0.1",
      port: 27017,
      username: "root",
      password: "",
      remember_password: false,
      url_params: "authSource=admin",
    };
    const connectDb = vi.fn().mockResolvedValue(connection.id);

    vi.doMock("@/lib/backend/tauriRuntime", () => ({ isTauriRuntime: () => false }));
    vi.doMock("@/lib/backend/api", () => ({
      connectDb,
      connectionDatabaseInfo: vi.fn().mockResolvedValue(undefined),
      connectionIdentifierQuote: vi.fn().mockResolvedValue(undefined),
      saveConnectionDatabaseInfo: vi.fn().mockResolvedValue(undefined),
      saveConnections: vi.fn().mockResolvedValue(undefined),
      saveSidebarLayout: vi.fn().mockResolvedValue(undefined),
    }));

    const [{ useConnectionStore }, { useConnectionCredentialStore }] = await Promise.all([import("@/stores/connectionStore"), import("@/stores/connectionCredentialStore")]);
    const store = useConnectionStore();
    const credentials = useConnectionCredentialStore();
    store.connections = [connection];

    const connecting = store.ensureConnected(connection.id);
    expect(credentials.pending).toEqual({
      connectionId: connection.id,
      connectionName: connection.name,
      fields: ["password"],
    });

    credentials.confirm({ password: "transient-secret" });
    await connecting;

    expect(connectDb).toHaveBeenCalledWith(expect.objectContaining({ id: connection.id, password: "transient-secret", remember_password: false }), expect.any(Number));
    expect(store.connections[0]?.password).toBe("");
  });

  it("checks the Mongo runtime driver without reloading the passwordless disk config", async () => {
    const connection: ConnectionConfig = {
      id: "mongo-runtime-driver",
      name: "MongoDB without saved password",
      db_type: "mongodb",
      driver_profile: "mongodb",
      host: "127.0.0.1",
      port: 27017,
      username: "root",
      password: "",
      remember_password: false,
      url_params: "authSource=admin",
    };
    const connectDb = vi.fn().mockResolvedValue(connection.id);
    const loadConnections = vi.fn();

    vi.doMock("@/lib/backend/tauriRuntime", () => ({ isTauriRuntime: () => true }));
    vi.doMock("@/lib/backend/api", () => ({
      connectDb,
      connectionRuntimeDriverProfile: vi.fn().mockResolvedValue("mongodb-legacy"),
      connectionDatabaseInfo: vi.fn().mockResolvedValue(undefined),
      connectionIdentifierQuote: vi.fn().mockResolvedValue(undefined),
      loadConnections,
      saveConnectionDatabaseInfo: vi.fn().mockResolvedValue(undefined),
      saveConnections: vi.fn().mockResolvedValue(undefined),
      saveSidebarLayout: vi.fn().mockResolvedValue(undefined),
    }));

    const [{ useConnectionStore }, { useConnectionCredentialStore }] = await Promise.all([import("@/stores/connectionStore"), import("@/stores/connectionCredentialStore")]);
    const store = useConnectionStore();
    const credentials = useConnectionCredentialStore();
    store.connections = [connection];

    const connecting = store.ensureConnected(connection.id);
    credentials.confirm({ password: "transient-secret" });
    await connecting;

    expect(loadConnections).not.toHaveBeenCalled();
    expect(store.connections[0]).toEqual(expect.objectContaining({ driver_profile: "mongodb-legacy", password: "", remember_password: false }));
  });

  it("prompts for and injects both Redis Sentinel passwords", async () => {
    const connection: ConnectionConfig = {
      id: "redis-sentinel-transient-passwords",
      name: "Redis Sentinel without saved passwords",
      db_type: "redis",
      host: "127.0.0.1",
      port: 26379,
      username: "default",
      password: "",
      remember_password: false,
      redis_connection_mode: "sentinel",
      redis_sentinel_master: "mymaster",
      redis_sentinel_password: "",
    };
    const connectDb = vi.fn().mockResolvedValue(connection.id);
    vi.doMock("@/lib/backend/tauriRuntime", () => ({ isTauriRuntime: () => false }));
    vi.doMock("@/lib/backend/api", () => ({
      connectDb,
      connectionDatabaseInfo: vi.fn().mockResolvedValue(undefined),
      connectionIdentifierQuote: vi.fn().mockResolvedValue(undefined),
      saveConnectionDatabaseInfo: vi.fn().mockResolvedValue(undefined),
      saveConnections: vi.fn().mockResolvedValue(undefined),
      saveSidebarLayout: vi.fn().mockResolvedValue(undefined),
    }));

    const [{ useConnectionStore }, { useConnectionCredentialStore }] = await Promise.all([import("@/stores/connectionStore"), import("@/stores/connectionCredentialStore")]);
    const store = useConnectionStore();
    const credentials = useConnectionCredentialStore();
    store.connections = [connection];

    const connecting = store.ensureConnected(connection.id);
    expect(credentials.pending?.fields).toEqual(["password", "redisSentinelPassword"]);
    credentials.confirm({ password: "database-secret", redisSentinelPassword: "sentinel-secret" });
    await connecting;

    expect(connectDb).toHaveBeenCalledWith(expect.objectContaining({ password: "database-secret", redis_sentinel_password: "sentinel-secret" }), expect.any(Number));
    expect(store.connections[0]).toEqual(expect.objectContaining({ password: "", redis_sentinel_password: "" }));
  });

  it("prompts for the active MQ authentication secret and injects it into external_config", async () => {
    const connection: ConnectionConfig = {
      id: "mq-transient-token",
      name: "Pulsar without saved token",
      db_type: "mq",
      host: "127.0.0.1",
      port: 8080,
      username: "",
      password: "",
      remember_password: false,
      external_config: { systemKind: "pulsar", adminUrl: "http://127.0.0.1:8080", auth: { kind: "token", token: "" } },
    };
    const connectDb = vi.fn().mockResolvedValue(connection.id);
    vi.doMock("@/lib/backend/tauriRuntime", () => ({ isTauriRuntime: () => false }));
    vi.doMock("@/lib/backend/api", () => ({
      connectDb,
      connectionDatabaseInfo: vi.fn().mockResolvedValue(undefined),
      connectionIdentifierQuote: vi.fn().mockResolvedValue(undefined),
      saveConnectionDatabaseInfo: vi.fn().mockResolvedValue(undefined),
      saveConnections: vi.fn().mockResolvedValue(undefined),
      saveSidebarLayout: vi.fn().mockResolvedValue(undefined),
    }));

    const [{ useConnectionStore }, { useConnectionCredentialStore }] = await Promise.all([import("@/stores/connectionStore"), import("@/stores/connectionCredentialStore")]);
    const store = useConnectionStore();
    const credentials = useConnectionCredentialStore();
    store.connections = [connection];

    const connecting = store.ensureConnected(connection.id);
    expect(credentials.pending?.fields).toEqual(["mqToken"]);
    credentials.confirm({ mqToken: "runtime-token" });
    await connecting;

    const runtimeConfig = connectDb.mock.calls[0]?.[0] as ConnectionConfig | undefined;
    expect(runtimeConfig?.external_config).toEqual(expect.objectContaining({ auth: expect.objectContaining({ kind: "token", token: "runtime-token" }) }));
  });

  it("uses credentials already present on a new Mongo URL without prompting and syncs the URI username", async () => {
    const connection: ConnectionConfig = {
      id: "new-mongo-url",
      name: "New Mongo URL",
      db_type: "mongodb",
      driver_profile: "mongodb",
      host: "127.0.0.1",
      port: 27017,
      username: "stale-user",
      password: "",
      remember_password: false,
      connection_string: "mongodb://uri-user:uri-secret@127.0.0.1:27017/admin",
    };
    const connectDb = vi.fn().mockResolvedValue(connection.id);
    vi.doMock("@/lib/backend/tauriRuntime", () => ({ isTauriRuntime: () => false }));
    vi.doMock("@/lib/backend/api", () => ({
      connectDb,
      connectionDatabaseInfo: vi.fn().mockResolvedValue(undefined),
      connectionIdentifierQuote: vi.fn().mockResolvedValue(undefined),
      saveConnectionDatabaseInfo: vi.fn().mockResolvedValue(undefined),
      saveConnections: vi.fn().mockResolvedValue(undefined),
      saveSidebarLayout: vi.fn().mockResolvedValue(undefined),
    }));

    const [{ useConnectionStore }, { useConnectionCredentialStore }] = await Promise.all([import("@/stores/connectionStore"), import("@/stores/connectionCredentialStore")]);
    const store = useConnectionStore();
    const credentials = useConnectionCredentialStore();

    await store.connect(connection);

    expect(credentials.pending).toBeUndefined();
    expect(connectDb).toHaveBeenCalledWith(expect.objectContaining({ username: "uri-user", password: "uri-secret", connection_string: connection.connection_string }), expect.any(Number));
  });

  it("persists refreshed database info using the passwordless config fingerprint", async () => {
    const connection: ConnectionConfig = {
      id: "postgres-transient-metadata",
      name: "PostgreSQL without saved password",
      db_type: "postgres",
      host: "127.0.0.1",
      port: 5432,
      username: "postgres",
      password: "",
      remember_password: false,
    };
    const connectDb = vi.fn().mockResolvedValue(connection.id);
    const saveConnectionDatabaseInfo = vi.fn().mockResolvedValue(undefined);
    vi.doMock("@/lib/backend/tauriRuntime", () => ({ isTauriRuntime: () => false }));
    vi.doMock("@/lib/backend/api", () => ({
      connectDb,
      connectionDatabaseInfo: vi.fn().mockResolvedValue({ productName: "PostgreSQL", productVersion: "17.2" }),
      connectionIdentifierQuote: vi.fn().mockResolvedValue(undefined),
      saveConnectionDatabaseInfo,
      saveConnections: vi.fn().mockResolvedValue(undefined),
      saveSidebarLayout: vi.fn().mockResolvedValue(undefined),
    }));

    const [{ useConnectionStore }, { useConnectionCredentialStore }] = await Promise.all([import("@/stores/connectionStore"), import("@/stores/connectionCredentialStore")]);
    const store = useConnectionStore();
    const credentials = useConnectionCredentialStore();
    store.connections = [connection];

    const connecting = store.ensureConnected(connection.id);
    credentials.confirm({ password: "transient-secret" });
    await connecting;
    await vi.waitFor(() => expect(saveConnectionDatabaseInfo).toHaveBeenCalledWith(connection.id, expect.objectContaining({ productVersion: "17.2" })));
    expect(store.connections[0]?.database_info).toEqual(expect.objectContaining({ productVersion: "17.2" }));
  });
});
