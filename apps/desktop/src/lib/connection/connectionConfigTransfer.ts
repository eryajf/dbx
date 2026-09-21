import type { ConnectionConfig, SidebarLayout, TunnelProfile } from "@/types/database";
import { filterSidebarLayoutByConnectionIds as filterLayoutByConnectionIds, remapSidebarLayoutConnectionIds } from "@/lib/sidebar/sidebarLayout";

export type ConnectionExportProtection = { mode: "encrypted"; passphrase: string } | { mode: "plaintext" };

export interface ConnectionConfigBundle {
  connections: ConnectionConfig[];
  layout?: SidebarLayout;
  tunnelProfiles?: TunnelProfile[];
}

export interface ConnectionConfigSnapshotOptions {
  connectTimeoutSecs: (connection: ConnectionConfig) => number;
  queryTimeoutSecs: (connection: ConnectionConfig) => number;
}

export function selectedConnectionIdSet(connectionIds: Iterable<string> | undefined): Set<string> | undefined {
  if (connectionIds == null) return undefined;
  return new Set(Array.from(connectionIds).filter((id) => typeof id === "string" && id.length > 0));
}

export function filterConnectionsByIds(connections: ConnectionConfig[], selectedIds?: Iterable<string>): ConnectionConfig[] {
  const selected = selectedConnectionIdSet(selectedIds);
  if (!selected) return [...connections];
  return connections.filter((connection) => selected.has(connection.id));
}

export function filterSidebarLayoutByConnectionIds(layout: SidebarLayout | null | undefined, selectedIds: Iterable<string>): SidebarLayout {
  return filterLayoutByConnectionIds(layout, Array.from(selectedConnectionIdSet(selectedIds) ?? []));
}

export function referencedTunnelProfileIds(connections: Iterable<Pick<ConnectionConfig, "transport_layers">>): Set<string> {
  const ids = new Set<string>();
  for (const connection of connections) {
    for (const layer of connection.transport_layers ?? []) {
      if (typeof layer.profile_id === "string" && layer.profile_id) ids.add(layer.profile_id);
    }
  }
  return ids;
}

export function filterTunnelProfilesByIds(profiles: TunnelProfile[], selectedIds: Iterable<string>): TunnelProfile[] {
  const selected = selectedConnectionIdSet(selectedIds);
  if (!selected) return [...profiles];
  const seen = new Set<string>();
  const filtered: TunnelProfile[] = [];
  for (const profile of profiles) {
    if (!selected.has(profile.id) || seen.has(profile.id)) continue;
    seen.add(profile.id);
    filtered.push(profile);
  }
  return filtered;
}

export function snapshotConnectionsForExport(connections: ConnectionConfig[], options: ConnectionConfigSnapshotOptions): ConnectionConfig[] {
  return connections.map((connection) => ({
    ...connection,
    connect_timeout_secs: connection.connect_timeout_inherit === true ? options.connectTimeoutSecs(connection) : connection.connect_timeout_secs,
    query_timeout_secs: connection.query_timeout_inherit === true ? options.queryTimeoutSecs(connection) : connection.query_timeout_secs,
  }));
}

/** Remove every credential-bearing field before creating a plaintext bundle. */
export function scrubConnectionForPlaintextExport(connection: ConnectionConfig): ConnectionConfig {
  const scrubbed: ConnectionConfig = JSON.parse(JSON.stringify(connection)) as ConnectionConfig;
  scrubbed.password = "";
  scrubbed.url_params = scrubUrlParams(scrubbed.url_params);
  scrubbed.init_script = undefined;
  scrubbed.connection_string = undefined;
  scrubbed.redis_sentinel_password = "";
  scrubbed.connection_secrets = {};
  scrubbed.transport_layers = (scrubbed.transport_layers ?? []).map((layer) => {
    const copy = { ...layer } as typeof layer;
    if (copy.type === "ssh") {
      copy.password = "";
      copy.key_passphrase = "";
    } else if (copy.type === "proxy") {
      copy.password = "";
    } else {
      copy.token = "";
    }
    return copy;
  });
  scrubbed.external_config = scrubExternalConfig(scrubbed.external_config);
  return scrubbed;
}

export function scrubTunnelProfileForPlaintextExport(profile: TunnelProfile): TunnelProfile {
  const scrubbed = { ...profile };
  if (scrubbed.type === "ssh") {
    scrubbed.password = "";
    scrubbed.key_passphrase = "";
  } else if (scrubbed.type === "proxy") {
    scrubbed.password = "";
  } else {
    scrubbed.token = "";
  }
  return scrubbed;
}

function scrubExternalConfig(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(scrubExternalConfig);
  if (!value || typeof value !== "object") return value;
  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (/password|passphrase|secret|token|api[_-]?key|clientsecret|accesstoken|privatekey/i.test(key)) {
      output[key] = typeof child === "string" ? "" : null;
    } else {
      output[key] = scrubExternalConfig(child);
    }
  }
  return output;
}

function scrubUrlParams(value: string | undefined): string | undefined {
  if (typeof value !== "string") return value;
  return value
    .split("&")
    .map((part) => {
      const separator = part.indexOf("=");
      if (separator < 0) return part;
      const key = part.slice(0, separator);
      const normalized = key.trim().toLowerCase().replace(/[_-]/g, "");
      return /password|passphrase|secret|token|apikey|privatekey|clientsecret/.test(normalized) ? key + "=" : part;
    })
    .join("&");
}

export function buildConnectionConfigBundle(connections: ConnectionConfig[], layout: SidebarLayout | null | undefined, tunnelProfiles: TunnelProfile[], selectedIds?: Iterable<string>): ConnectionConfigBundle {
  const selectedConnections = filterConnectionsByIds(connections, selectedIds);
  const selectedConnectionIds = selectedConnections.map((connection) => connection.id);
  return {
    connections: selectedConnections,
    layout: filterSidebarLayoutByConnectionIds(layout, selectedConnectionIds),
    tunnelProfiles: filterTunnelProfilesByIds(tunnelProfiles, referencedTunnelProfileIds(selectedConnections)),
  };
}

export function parseConnectionConfigObject(value: unknown): ConnectionConfigBundle {
  if (Array.isArray(value)) {
    return { connections: value as ConnectionConfig[] };
  }

  if (!value || typeof value !== "object") {
    return { connections: [] };
  }

  const parsed = value as {
    format?: unknown;
    connections?: unknown;
    layout?: SidebarLayout;
    tunnelProfiles?: unknown;
  };

  if (parsed.format === "dbx-config" && Array.isArray(parsed.connections)) {
    return { connections: parsed.connections as ConnectionConfig[] };
  }

  if (Array.isArray(parsed.connections)) {
    return {
      connections: parsed.connections as ConnectionConfig[],
      layout: parsed.layout?.groups && parsed.layout?.order ? parsed.layout : undefined,
      tunnelProfiles: Array.isArray(parsed.tunnelProfiles) ? (parsed.tunnelProfiles as TunnelProfile[]) : undefined,
    };
  }

  return { connections: [] };
}

export function selectConnectionConfigBundle(bundle: ConnectionConfigBundle, selectedIds?: Iterable<string>): ConnectionConfigBundle {
  const selectedConnections = filterConnectionsByIds(bundle.connections, selectedIds);
  const selectedConnectionIds = selectedConnections.map((connection) => connection.id);
  return {
    connections: selectedConnections,
    layout: bundle.layout ? filterSidebarLayoutByConnectionIds(bundle.layout, selectedConnectionIds) : undefined,
    tunnelProfiles: filterTunnelProfilesByIds(bundle.tunnelProfiles ?? [], referencedTunnelProfileIds(selectedConnections)),
  };
}

/** Ordinary file imports create copies on collision; cloud sync keeps its own ID merge policy. */
export function prepareConnectionConfigImport(bundle: ConnectionConfigBundle, existingConnectionIds: Iterable<string>, existingTunnelProfileIds: Iterable<string>, createId: () => string): ConnectionConfigBundle {
  function allocateIds(sourceIds: string[], existingIds: Iterable<string>): Map<string, string> {
    const occupied = new Set(existingIds);
    const reserved = new Set(sourceIds.filter(Boolean));
    const seen = new Set<string>();
    const result = new Map<string, string>();
    for (const sourceId of sourceIds) {
      if (sourceId && seen.has(sourceId)) throw new Error("DUPLICATE_IMPORT_ID");
      seen.add(sourceId);
      let targetId = sourceId;
      if (!targetId || occupied.has(targetId)) {
        do {
          targetId = createId();
        } while (!targetId || occupied.has(targetId) || reserved.has(targetId));
      }
      occupied.add(targetId);
      result.set(sourceId, targetId);
    }
    return result;
  }
  const sourceConnections = bundle.connections.map((connection) => ({ ...connection, id: connection.id?.trim() ?? "" }));
  // Anonymous legacy entries need their own ID even when several omit it.
  for (const connection of sourceConnections) {
    if (!connection.id) connection.id = createId();
  }
  const connectionIds = allocateIds(
    sourceConnections.map((connection) => connection.id),
    existingConnectionIds,
  );
  const profiles = (bundle.tunnelProfiles ?? []).map((profile) => ({ ...profile, id: profile.id?.trim() || createId() }));
  const profileIds = allocateIds(
    profiles.map((profile) => profile.id),
    existingTunnelProfileIds,
  );
  return {
    connections: sourceConnections.map((connection) => ({
      ...connection,
      id: connectionIds.get(connection.id)!,
      transport_layers: connection.transport_layers?.map((layer) => ({
        ...layer,
        // Never leave an unresolved source ID pointing at an unrelated local profile.
        profile_id: layer.profile_id ? profileIds.get(layer.profile_id) : undefined,
      })),
    })),
    tunnelProfiles: profiles.map((profile) => ({ ...profile, id: profileIds.get(profile.id)! })),
    layout: bundle.layout ? filterSidebarLayoutByConnectionIds(remapSidebarLayoutConnectionIds(bundle.layout, connectionIds), connectionIds.values()) : undefined,
  };
}
