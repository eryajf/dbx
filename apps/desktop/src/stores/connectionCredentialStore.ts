import { ref } from "vue";
import { defineStore } from "pinia";
import type { ConnectionCredentialField, ConnectionCredentialValues } from "@/lib/connection/connectionPasswordPersistence";

export interface ConnectionCredentialRequest {
  connectionId: string;
  connectionName: string;
  fields: ConnectionCredentialField[];
}

interface QueuedCredentialRequest {
  request: ConnectionCredentialRequest;
  resolve: (credentials: ConnectionCredentialValues | null) => void;
}

export const useConnectionCredentialStore = defineStore("connectionCredential", () => {
  const pending = ref<ConnectionCredentialRequest>();
  const queue: QueuedCredentialRequest[] = [];
  let resolvePending: ((credentials: ConnectionCredentialValues | null) => void) | undefined;

  function requestCredentials(request: ConnectionCredentialRequest): Promise<ConnectionCredentialValues | null> {
    return new Promise((resolve) => {
      if (pending.value) {
        queue.push({ request, resolve });
        return;
      }
      beginRequest(request, resolve);
    });
  }

  function beginRequest(request: ConnectionCredentialRequest, resolve: (credentials: ConnectionCredentialValues | null) => void) {
    pending.value = request;
    resolvePending = resolve;
  }

  function settle(credentials: ConnectionCredentialValues | null) {
    const resolve = resolvePending;
    resolvePending = undefined;
    pending.value = undefined;
    resolve?.(credentials);

    const next = queue.shift();
    if (next) beginRequest(next.request, next.resolve);
  }

  function confirm(credentials: ConnectionCredentialValues) {
    settle(credentials);
  }

  function cancel() {
    settle(null);
  }

  return { pending, requestCredentials, confirm, cancel };
});
