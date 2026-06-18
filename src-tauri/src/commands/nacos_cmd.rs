use std::sync::Arc;

use tauri::State;

use crate::commands::connection::{ensure_connection_writable, AppState};

#[tauri::command]
pub async fn nacos_test_connection(
    state: State<'_, Arc<AppState>>,
    connection_id: String,
) -> Result<dbx_core::nacos::NacosConnectionInfo, String> {
    dbx_core::nacos::service::nacos_test_connection_core(&state, &connection_id).await
}

#[tauri::command]
pub async fn nacos_list_namespaces(
    state: State<'_, Arc<AppState>>,
    connection_id: String,
) -> Result<Vec<dbx_core::nacos::NacosNamespaceInfo>, String> {
    dbx_core::nacos::service::nacos_list_namespaces_core(&state, &connection_id).await
}

#[tauri::command]
pub async fn nacos_list_configs(
    state: State<'_, Arc<AppState>>,
    connection_id: String,
    query: dbx_core::nacos::NacosConfigQuery,
) -> Result<dbx_core::nacos::NacosConfigList, String> {
    dbx_core::nacos::service::nacos_list_configs_core(&state, &connection_id, query).await
}

#[tauri::command]
pub async fn nacos_get_config(
    state: State<'_, Arc<AppState>>,
    connection_id: String,
    key: dbx_core::nacos::NacosConfigKey,
) -> Result<dbx_core::nacos::NacosConfigItem, String> {
    dbx_core::nacos::service::nacos_get_config_core(&state, &connection_id, key).await
}

#[tauri::command]
pub async fn nacos_publish_config(
    state: State<'_, Arc<AppState>>,
    connection_id: String,
    req: dbx_core::nacos::NacosConfigUpsert,
) -> Result<(), String> {
    ensure_connection_writable(&state, &connection_id, "Publish Nacos config").await?;
    dbx_core::nacos::service::nacos_publish_config_core(&state, &connection_id, req).await
}

#[tauri::command]
pub async fn nacos_delete_config(
    state: State<'_, Arc<AppState>>,
    connection_id: String,
    key: dbx_core::nacos::NacosConfigKey,
) -> Result<(), String> {
    ensure_connection_writable(&state, &connection_id, "Delete Nacos config").await?;
    dbx_core::nacos::service::nacos_delete_config_core(&state, &connection_id, key).await
}

#[tauri::command]
pub async fn nacos_list_services(
    state: State<'_, Arc<AppState>>,
    connection_id: String,
    query: dbx_core::nacos::NacosServiceQuery,
) -> Result<dbx_core::nacos::NacosServiceList, String> {
    dbx_core::nacos::service::nacos_list_services_core(&state, &connection_id, query).await
}

#[tauri::command]
pub async fn nacos_list_instances(
    state: State<'_, Arc<AppState>>,
    connection_id: String,
    query: dbx_core::nacos::NacosInstanceQuery,
) -> Result<Vec<dbx_core::nacos::NacosInstanceInfo>, String> {
    dbx_core::nacos::service::nacos_list_instances_core(&state, &connection_id, query).await
}

#[tauri::command]
pub async fn nacos_update_instance(
    state: State<'_, Arc<AppState>>,
    connection_id: String,
    req: dbx_core::nacos::NacosInstanceUpdate,
) -> Result<(), String> {
    ensure_connection_writable(&state, &connection_id, "Update Nacos instance").await?;
    dbx_core::nacos::service::nacos_update_instance_core(&state, &connection_id, req).await
}

#[tauri::command]
pub async fn nacos_raw_request(
    state: State<'_, Arc<AppState>>,
    connection_id: String,
    req: dbx_core::nacos::NacosRawRequest,
) -> Result<dbx_core::nacos::NacosRawResponse, String> {
    if req.method.to_ascii_uppercase() != "GET" {
        ensure_connection_writable(&state, &connection_id, "Run mutating Nacos raw request").await?;
    }
    dbx_core::nacos::service::nacos_raw_request_core(&state, &connection_id, req).await
}
