import type { ConnectionConfig } from "@/types/database";

export type ConnectionCredentialField = "password" | "redisSentinelPassword" | "mqToken" | "mqBasicPassword" | "mqApiKeyValue" | "mqOauthClientSecret";

export type ConnectionCredentialValues = Partial<Record<ConnectionCredentialField, string>>;

type JsonRecord = Record<string, unknown>;

interface ConnectionStringCredentials {
  username?: string;
  password?: string;
}

function isRecord(value: unknown): value is JsonRecord {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function decodeCredential(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function encodeCredential(value: string): string {
  return encodeURIComponent(value);
}

function authorityRange(value: string): { start: number; end: number } | undefined {
  const separator = value.indexOf("://");
  if (separator < 0) return undefined;
  const start = separator + 3;
  const relativeEnd = value.slice(start).search(/[/?#]/);
  return { start, end: relativeEnd < 0 ? value.length : start + relativeEnd };
}

function authorityCredentials(value: string): ConnectionStringCredentials {
  const range = authorityRange(value);
  if (!range) return {};
  const authority = value.slice(range.start, range.end);
  const at = authority.lastIndexOf("@");
  if (at < 0) return {};
  const userInfo = authority.slice(0, at);
  const colon = userInfo.indexOf(":");
  if (colon < 0) return { username: decodeCredential(userInfo) };
  return {
    username: decodeCredential(userInfo.slice(0, colon)),
    password: decodeCredential(userInfo.slice(colon + 1)),
  };
}

function stripAuthorityPassword(value: string): string {
  const range = authorityRange(value);
  if (!range) return value;
  const authority = value.slice(range.start, range.end);
  const at = authority.lastIndexOf("@");
  if (at < 0) return value;
  const userInfo = authority.slice(0, at);
  const colon = userInfo.indexOf(":");
  if (colon < 0) return value;
  const username = userInfo.slice(0, colon);
  const sanitizedAuthority = username ? `${username}@${authority.slice(at + 1)}` : authority.slice(at + 1);
  return `${value.slice(0, range.start)}${sanitizedAuthority}${value.slice(range.end)}`;
}

function injectAuthorityPassword(value: string, username: string, password: string): string {
  const range = authorityRange(value);
  if (!range || !username) return value;
  const authority = value.slice(range.start, range.end);
  const at = authority.lastIndexOf("@");
  const host = at < 0 ? authority : authority.slice(at + 1);
  const userInfo = `${encodeCredential(username)}:${encodeCredential(password)}@`;
  return `${value.slice(0, range.start)}${userInfo}${host}${value.slice(range.end)}`;
}

function semicolonCredential(value: string, name: string): string | undefined {
  const normalizedName = name.toLowerCase();
  for (const part of value.split(";").slice(1)) {
    const [rawKey, ...rest] = part.split("=");
    if (decodeCredential(rawKey).trim().toLowerCase() === normalizedName) {
      return decodeCredential(rest.join("=").trim());
    }
  }
  return undefined;
}

function stripSemicolonCredential(value: string, name: string): string {
  const normalizedName = name.toLowerCase();
  const [base, ...parts] = value.split(";");
  const retained = parts.filter((part) => {
    const [rawKey] = part.split("=");
    return decodeCredential(rawKey).trim().toLowerCase() !== normalizedName;
  });
  return [base, ...retained].join(";");
}

function queryCredential(value: string, name: string): string | undefined {
  const queryStart = value.indexOf("?");
  if (queryStart < 0) return undefined;
  const fragmentStart = value.indexOf("#", queryStart);
  const query = value.slice(queryStart + 1, fragmentStart < 0 ? undefined : fragmentStart);
  const normalizedName = name.toLowerCase();
  for (const part of query.split("&")) {
    const [rawKey, ...rest] = part.split("=");
    if (decodeCredential(rawKey).trim().toLowerCase() === normalizedName) {
      return decodeCredential(rest.join("="));
    }
  }
  return undefined;
}

const TURSO_AUTH_TOKEN_KEYS = new Set(["auth_token", "authtoken", "auth-token"]);

function tursoAuthTokenFromUrlParams(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const params = value.trim().replace(/^[?&]+/, "");
  for (const part of params.split("&")) {
    const [rawKey, ...rest] = part.split("=");
    if (TURSO_AUTH_TOKEN_KEYS.has(decodeCredential(rawKey).trim().toLowerCase())) {
      return decodeCredential(rest.join("=").trim());
    }
  }
  return undefined;
}

function tursoUrlParamsWithoutAuthToken(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  const prefix = trimmed.startsWith("?") ? "?" : "";
  const retained = trimmed
    .replace(/^[?&]+/, "")
    .split("&")
    .filter((part) => {
      const [rawKey] = part.split("=");
      return !TURSO_AUTH_TOKEN_KEYS.has(decodeCredential(rawKey).trim().toLowerCase());
    })
    .filter(Boolean);
  return retained.length ? `${prefix}${retained.join("&")}` : "";
}

function stripQueryCredential(value: string, name: string): string {
  const queryStart = value.indexOf("?");
  if (queryStart < 0) return value;
  const fragmentStart = value.indexOf("#", queryStart);
  const suffix = fragmentStart < 0 ? "" : value.slice(fragmentStart);
  const normalizedName = name.toLowerCase();
  const retained = value
    .slice(queryStart + 1, fragmentStart < 0 ? undefined : fragmentStart)
    .split("&")
    .filter((part) => {
      const [rawKey] = part.split("=");
      return decodeCredential(rawKey).trim().toLowerCase() !== normalizedName;
    });
  return `${value.slice(0, queryStart)}${retained.length ? `?${retained.join("&")}` : ""}${suffix}`;
}

function isDremioConnection(config: Pick<ConnectionConfig, "driver_profile" | "connection_string">): boolean {
  const value = config.connection_string?.trim() || "";
  return config.driver_profile === "dremio" || /^jdbc:(?:dremio:|arrow-flight-sql:)/i.test(value);
}

function connectionStringCredentials(config: ConnectionConfig): ConnectionStringCredentials {
  const value = config.connection_string?.trim();
  if (!value) return {};
  if (config.db_type === "mongodb") return authorityCredentials(value);
  if (config.db_type === "h2") {
    return {
      username: semicolonCredential(value, "user"),
      password: semicolonCredential(value, "password") ?? semicolonCredential(value, "pwd"),
    };
  }
  if (isDremioConnection(config)) {
    const authority = authorityCredentials(value);
    return {
      username: authority.username ?? semicolonCredential(value, "user"),
      password: authority.password ?? semicolonCredential(value, "password") ?? semicolonCredential(value, "pwd") ?? queryCredential(value, "password") ?? queryCredential(value, "pwd"),
    };
  }
  if (config.db_type === "jdbc") {
    const authority = authorityCredentials(value);
    return {
      username: authority.username ?? semicolonCredential(value, "user") ?? semicolonCredential(value, "username") ?? queryCredential(value, "user") ?? queryCredential(value, "username"),
      password: authority.password ?? semicolonCredential(value, "password") ?? semicolonCredential(value, "pwd") ?? queryCredential(value, "password") ?? queryCredential(value, "pwd"),
    };
  }
  return {};
}

function sanitizeConnectionString(config: ConnectionConfig): { connectionString: string | undefined; username?: string } {
  const value = config.connection_string;
  if (!value) return { connectionString: value };
  const embedded = connectionStringCredentials(config);
  if (config.db_type === "mongodb") {
    return { connectionString: stripAuthorityPassword(value), username: embedded.username };
  }
  if (config.db_type === "h2") {
    return {
      connectionString: stripSemicolonCredential(stripSemicolonCredential(value, "password"), "pwd"),
      username: embedded.username,
    };
  }
  if (isDremioConnection(config)) {
    let sanitized = stripAuthorityPassword(value);
    sanitized = stripSemicolonCredential(sanitized, "password");
    sanitized = stripSemicolonCredential(sanitized, "pwd");
    sanitized = stripQueryCredential(sanitized, "password");
    sanitized = stripQueryCredential(sanitized, "pwd");
    return { connectionString: sanitized, username: embedded.username };
  }
  if (config.db_type === "jdbc") {
    let sanitized = stripAuthorityPassword(value);
    sanitized = stripSemicolonCredential(sanitized, "password");
    sanitized = stripSemicolonCredential(sanitized, "pwd");
    sanitized = stripQueryCredential(sanitized, "password");
    sanitized = stripQueryCredential(sanitized, "pwd");
    return { connectionString: sanitized, username: embedded.username };
  }
  return { connectionString: value };
}

function connectionStringWithPassword(config: ConnectionConfig, password: string): string | undefined {
  const value = config.connection_string;
  if (!value) return value;
  const embedded = connectionStringCredentials(config);
  const username = embedded.username || config.username;
  if (config.db_type === "mongodb") return injectAuthorityPassword(stripAuthorityPassword(value), username, password);
  if (config.db_type === "h2") return sanitizeConnectionString(config).connectionString;
  if (isDremioConnection(config)) {
    if (/^jdbc:arrow-flight-sql:\/\//i.test(value)) {
      const withoutQueryPassword = stripQueryCredential(stripQueryCredential(value, "password"), "pwd");
      return injectAuthorityPassword(stripAuthorityPassword(withoutQueryPassword), username, password);
    }
    return sanitizeConnectionString(config).connectionString;
  }
  if (config.db_type === "jdbc") return sanitizeConnectionString(config).connectionString;
  return value;
}

function externalAuth(config: ConnectionConfig): JsonRecord | undefined {
  if (!isRecord(config.external_config) || !isRecord(config.external_config.auth)) return undefined;
  return config.external_config.auth;
}

function mqCredentialField(config: ConnectionConfig): ConnectionCredentialField | undefined {
  if (config.db_type !== "mq") return undefined;
  switch (externalAuth(config)?.kind) {
    case "token":
      return "mqToken";
    case "basic":
      return "mqBasicPassword";
    case "apiKey":
    case "api_key":
    case "apikey":
      return "mqApiKeyValue";
    case "oauth2":
      return "mqOauthClientSecret";
    default:
      return undefined;
  }
}

export function connectionCredentialFields(config: ConnectionConfig): ConnectionCredentialField[] {
  if (config.db_type === "mq") {
    const field = mqCredentialField(config);
    return field ? [field] : [];
  }
  if (config.db_type === "nacos" && externalAuth(config)?.kind !== "usernamePassword") return [];
  if (config.db_type === "redis" && config.redis_connection_mode === "sentinel") {
    return ["password", "redisSentinelPassword"];
  }
  return ["password"];
}

export function connectionCredentialValues(config: ConnectionConfig): ConnectionCredentialValues {
  const embedded = connectionStringCredentials(config);
  const auth = externalAuth(config);
  const tursoAuthToken = config.db_type === "turso" ? tursoAuthTokenFromUrlParams(config.url_params) : undefined;
  const primaryPassword = config.db_type === "nacos" && auth?.kind === "usernamePassword" && typeof auth.password === "string" ? auth.password || config.password : (embedded.password ?? (config.password || tursoAuthToken || ""));
  return {
    password: primaryPassword,
    redisSentinelPassword: config.redis_sentinel_password || "",
    mqToken: auth?.kind === "token" && typeof auth.token === "string" ? auth.token : "",
    mqBasicPassword: auth?.kind === "basic" && typeof auth.password === "string" ? auth.password : "",
    mqApiKeyValue: (auth?.kind === "apiKey" || auth?.kind === "api_key" || auth?.kind === "apikey") && typeof auth.value === "string" ? auth.value : "",
    mqOauthClientSecret: auth?.kind === "oauth2" && typeof auth.clientSecret === "string" ? auth.clientSecret : "",
  };
}

function connectionWithExternalAuthCredential(config: ConnectionConfig, credentials: ConnectionCredentialValues): ConnectionConfig {
  const external = isRecord(config.external_config) ? config.external_config : undefined;
  const auth = external && isRecord(external.auth) ? external.auth : undefined;
  if (!external || !auth) return config;

  let secretPatch: JsonRecord | undefined;
  if (config.db_type === "nacos" && auth.kind === "usernamePassword" && credentials.password !== undefined) {
    secretPatch = { password: credentials.password };
  } else if (config.db_type === "mq") {
    if (auth.kind === "token" && credentials.mqToken !== undefined) secretPatch = { token: credentials.mqToken };
    if (auth.kind === "basic" && credentials.mqBasicPassword !== undefined) secretPatch = { password: credentials.mqBasicPassword };
    if ((auth.kind === "apiKey" || auth.kind === "api_key" || auth.kind === "apikey") && credentials.mqApiKeyValue !== undefined) {
      secretPatch = { value: credentials.mqApiKeyValue };
    }
    if (auth.kind === "oauth2" && credentials.mqOauthClientSecret !== undefined) secretPatch = { clientSecret: credentials.mqOauthClientSecret };
  }
  if (!secretPatch) return config;
  return {
    ...config,
    external_config: {
      ...external,
      auth: { ...auth, ...secretPatch },
    },
  };
}

export function connectionWithCredentials(config: ConnectionConfig, credentials: ConnectionCredentialValues): ConnectionConfig {
  const embedded = connectionStringCredentials(config);
  const password = credentials.password;
  let runtimeConfig: ConnectionConfig = {
    ...config,
    ...(embedded.username ? { username: embedded.username } : {}),
    ...(password !== undefined ? { password, connection_string: connectionStringWithPassword(config, password) } : {}),
    ...(credentials.redisSentinelPassword !== undefined ? { redis_sentinel_password: credentials.redisSentinelPassword } : {}),
  };
  runtimeConfig = connectionWithExternalAuthCredential(runtimeConfig, credentials);
  return runtimeConfig;
}

export function connectionWithPrimaryPassword(config: ConnectionConfig, password: string): ConnectionConfig {
  return connectionWithCredentials(config, { password });
}

export function persistentConnectionConfig(config: ConnectionConfig): ConnectionConfig {
  const tursoAuthToken = config.db_type === "turso" ? tursoAuthTokenFromUrlParams(config.url_params) : undefined;
  const normalizedConfig: ConnectionConfig =
    config.db_type === "turso"
      ? {
          ...config,
          password: config.password || tursoAuthToken || "",
          url_params: tursoUrlParamsWithoutAuthToken(config.url_params),
        }
      : config;
  if (normalizedConfig.remember_password !== false) return normalizedConfig;
  const sanitizedConnectionString = sanitizeConnectionString(normalizedConfig);
  const cleared = connectionWithCredentials(
    {
      ...normalizedConfig,
      ...(sanitizedConnectionString.username ? { username: sanitizedConnectionString.username } : {}),
      connection_string: sanitizedConnectionString.connectionString,
    },
    {
      password: "",
      redisSentinelPassword: "",
      mqToken: "",
      mqBasicPassword: "",
      mqApiKeyValue: "",
      mqOauthClientSecret: "",
    },
  );
  return { ...cleared, connection_string: sanitizedConnectionString.connectionString };
}
