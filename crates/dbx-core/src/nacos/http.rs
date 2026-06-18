use std::collections::HashMap;
use std::time::{Duration, Instant};

use async_trait::async_trait;
use reqwest::header::{HeaderMap, HeaderValue};
use serde_json::Value;
use tokio::sync::Mutex;

use crate::nacos::config::{NacosAdminConfig, NacosAuthConfig};
use crate::nacos::port::NacosAdmin;
use crate::nacos::types::*;

const REQUEST_TIMEOUT_SECS: u64 = 30;
const MAX_RAW_RESPONSE_BYTES: usize = 10 * 1024 * 1024;

#[derive(Debug, Clone)]
struct AccessToken {
    token: String,
    expires_at: Instant,
}

pub struct NacosOpenApiAdmin {
    cfg: NacosAdminConfig,
    http: reqwest::Client,
    token: Mutex<Option<AccessToken>>,
}

impl NacosOpenApiAdmin {
    pub fn new(cfg: NacosAdminConfig) -> Result<Self, String> {
        let mut builder = reqwest::Client::builder().timeout(Duration::from_secs(REQUEST_TIMEOUT_SECS));
        if cfg.tls_skip_verify {
            builder = builder.danger_accept_invalid_certs(true);
        }
        if let Some(connect_override) = cfg.connect_override.as_ref() {
            let url =
                reqwest::Url::parse(&cfg.server_addr).map_err(|e| format!("Nacos server address is invalid: {e}"))?;
            let host = url.host_str().ok_or("Nacos server address host is empty")?;
            let _port = url.port_or_known_default().ok_or("Nacos server address port is empty")?;
            builder = builder.resolve(
                host,
                std::net::SocketAddr::new(
                    connect_override
                        .host
                        .parse()
                        .map_err(|e| format!("Nacos transport override host must be an IP address: {e}"))?,
                    connect_override.port,
                ),
            );
        }
        let http = builder.build().map_err(|e| format!("Failed to build Nacos HTTP client: {e}"))?;
        Ok(Self { cfg, http, token: Mutex::new(None) })
    }

    fn endpoint(&self, path: &str) -> Result<String, String> {
        let path = normalize_api_path(path);
        let base = format!("{}{}", self.cfg.server_addr, self.cfg.context_path);
        let base = base.trim_end_matches('/');
        let full = if path.starts_with("/nacos/") && self.cfg.context_path == "/nacos" {
            format!("{}{}", self.cfg.server_addr, path)
        } else {
            format!("{base}{path}")
        };
        reqwest::Url::parse(&full).map(|url| url.to_string()).map_err(|e| format!("Nacos API URL is invalid: {e}"))
    }

    async fn access_token(&self) -> Result<Option<String>, String> {
        let NacosAuthConfig::UsernamePassword { username, password } = &self.cfg.auth else {
            return Ok(None);
        };
        if username.trim().is_empty() {
            return Ok(None);
        }
        {
            let guard = self.token.lock().await;
            if let Some(token) = guard.as_ref() {
                if token.expires_at > Instant::now() + Duration::from_secs(30) {
                    return Ok(Some(token.token.clone()));
                }
            }
        }

        let url = self.endpoint("/v1/auth/login")?;
        let resp = self
            .http
            .post(url)
            .form(&[("username", username.as_str()), ("password", password.as_str())])
            .send()
            .await
            .map_err(|e| format!("Nacos auth request failed: {e}"))?;
        let resp = error_for_status(resp, "/v1/auth/login").await?;
        let value: Value = resp.json().await.map_err(|e| format!("Failed to parse Nacos auth response: {e}"))?;
        let token = value
            .get("accessToken")
            .or_else(|| value.get("access_token"))
            .and_then(Value::as_str)
            .ok_or("Nacos auth response did not include an access token")?
            .to_string();
        let ttl = value.get("tokenTtl").or_else(|| value.get("expiresIn")).and_then(Value::as_u64).unwrap_or(18_000);
        *self.token.lock().await = Some(AccessToken {
            token: token.clone(),
            expires_at: Instant::now() + Duration::from_secs(ttl.saturating_sub(30).max(60)),
        });
        Ok(Some(token))
    }

    async fn request(
        &self,
        method: reqwest::Method,
        path: &str,
        mut query: Vec<(String, String)>,
        form: Option<Vec<(String, String)>>,
        body: Option<Value>,
    ) -> Result<reqwest::Response, String> {
        if let Some(token) = self.access_token().await? {
            query.push(("accessToken".to_string(), token));
        }
        let mut req = self.http.request(method, self.endpoint(path)?).query(&query);
        if let Some(form) = form {
            req = req.form(&form);
        }
        if let Some(body) = body {
            req = req.json(&body);
        }
        req.send().await.map_err(|e| format!("Nacos request to {path} failed: {e}"))
    }

    async fn get_json(&self, path: &str, query: Vec<(String, String)>) -> Result<Value, String> {
        let resp = self.request(reqwest::Method::GET, path, query, None, None).await?;
        let resp = error_for_status(resp, path).await?;
        response_json_or_text(resp).await
    }

    fn namespace(&self, override_ns: Option<&str>) -> String {
        override_ns.unwrap_or(&self.cfg.namespace).trim().to_string()
    }

    async fn list_configs_by_client_filter(
        &self,
        namespace: String,
        group: Option<String>,
        data_id_filter: Option<String>,
        page_no: u32,
        page_size: u32,
    ) -> Result<NacosConfigList, String> {
        let Some(filter) = data_id_filter.map(|value| value.to_lowercase()).filter(|value| !value.is_empty()) else {
            return Ok(NacosConfigList { page_no, page_size, total_count: 0, items: Vec::new() });
        };
        let group = group.unwrap_or_default();
        let scan_page_size = page_size.max(self.cfg.page_size).clamp(100, 500);
        let max_scan_pages = 10;
        let mut matched = Vec::new();
        let mut current_page = 1;

        while current_page <= max_scan_pages {
            let params = vec![
                ("search".to_string(), "blur".to_string()),
                ("dataId".to_string(), String::new()),
                ("group".to_string(), group.clone()),
                ("tenant".to_string(), namespace.clone()),
                ("pageNo".to_string(), current_page.to_string()),
                ("pageSize".to_string(), scan_page_size.to_string()),
            ];
            let value = self.get_json("/v1/cs/configs", params).await?;
            let list = parse_config_list(value, namespace.clone(), current_page, scan_page_size);
            matched.extend(list.items.into_iter().filter(|item| item.data_id.to_lowercase().contains(&filter)));

            let scanned = u64::from(current_page) * u64::from(scan_page_size);
            if scanned >= list.total_count || list.total_count == 0 {
                break;
            }
            current_page += 1;
        }

        let total_count = matched.len() as u64;
        let start = ((page_no.saturating_sub(1)) * page_size) as usize;
        let end = start.saturating_add(page_size as usize).min(matched.len());
        let items = if start < matched.len() { matched[start..end].to_vec() } else { Vec::new() };
        Ok(NacosConfigList { page_no, page_size, total_count, items })
    }
}

#[async_trait]
impl NacosAdmin for NacosOpenApiAdmin {
    async fn test_connection(&self) -> Result<NacosConnectionInfo, String> {
        let raw = match self.get_json("/v1/ns/operator/servers", Vec::new()).await {
            Ok(value) => value,
            Err(_) => self.get_json("/v1/console/server/state", Vec::new()).await?,
        };
        Ok(NacosConnectionInfo {
            server_addr: self.cfg.server_addr.clone(),
            namespace: self.cfg.namespace.clone(),
            server_version: extract_server_version(&raw),
            auth: match self.cfg.auth {
                NacosAuthConfig::None => "none".to_string(),
                NacosAuthConfig::UsernamePassword { .. } => "usernamePassword".to_string(),
            },
            capabilities: NacosCapabilities::default(),
            raw: Some(raw),
        })
    }

    async fn list_namespaces(&self) -> Result<Vec<NacosNamespaceInfo>, String> {
        let value = self.get_json("/v1/console/namespaces", Vec::new()).await?;
        Ok(parse_namespaces(value))
    }

    async fn list_configs(&self, query: NacosConfigQuery) -> Result<NacosConfigList, String> {
        let page_no = query.page_no.unwrap_or(1).max(1);
        let page_size = query.page_size.unwrap_or(self.cfg.page_size).clamp(1, 500);
        let namespace = self.namespace(query.namespace.as_deref());
        let data_id_filter = query
            .data_id
            .clone()
            .or(query.search.clone())
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());
        let search = data_id_filter.clone().unwrap_or_default();
        let group_filter = query.group.clone();
        let group = group_filter.clone().unwrap_or_default();
        let params = vec![
            ("search".to_string(), "blur".to_string()),
            ("dataId".to_string(), search),
            ("group".to_string(), group),
            ("tenant".to_string(), namespace.clone()),
            ("pageNo".to_string(), page_no.to_string()),
            ("pageSize".to_string(), page_size.to_string()),
        ];
        let value = self.get_json("/v1/cs/configs", params).await?;
        let parsed = parse_config_list(value, namespace.clone(), page_no, page_size);
        if data_id_filter.is_some() && parsed.items.is_empty() {
            let fallback =
                self.list_configs_by_client_filter(namespace, group_filter, data_id_filter, page_no, page_size).await?;
            if !fallback.items.is_empty() {
                return Ok(fallback);
            }
        }
        Ok(parsed)
    }

    async fn get_config(&self, key: NacosConfigKey) -> Result<NacosConfigItem, String> {
        let namespace = self.namespace(key.namespace.as_deref());
        let content = self
            .request(
                reqwest::Method::GET,
                "/v1/cs/configs",
                vec![
                    ("dataId".to_string(), key.data_id.clone()),
                    ("group".to_string(), key.group.clone()),
                    ("tenant".to_string(), namespace.clone()),
                ],
                None,
                None,
            )
            .await?;
        let resp = error_for_status(content, "/v1/cs/configs").await?;
        let text = resp.text().await.map_err(|e| format!("Failed to read Nacos config response: {e}"))?;
        Ok(NacosConfigItem {
            data_id: key.data_id,
            group: key.group,
            namespace,
            app_name: None,
            desc: None,
            config_type: None,
            md5: None,
            encrypted_data_key: None,
            content: Some(text),
        })
    }

    async fn publish_config(&self, req: NacosConfigUpsert) -> Result<(), String> {
        let namespace = self.namespace(req.namespace.as_deref());
        let mut form = vec![
            ("dataId".to_string(), req.data_id),
            ("group".to_string(), req.group),
            ("content".to_string(), req.content),
            ("tenant".to_string(), namespace),
        ];
        push_optional(&mut form, "type", req.config_type);
        push_optional(&mut form, "appName", req.app_name);
        push_optional(&mut form, "desc", req.desc);
        let resp = self.request(reqwest::Method::POST, "/v1/cs/configs", Vec::new(), Some(form), None).await?;
        error_for_status(resp, "/v1/cs/configs").await?;
        Ok(())
    }

    async fn delete_config(&self, key: NacosConfigKey) -> Result<(), String> {
        let namespace = self.namespace(key.namespace.as_deref());
        let resp = self
            .request(
                reqwest::Method::DELETE,
                "/v1/cs/configs",
                vec![
                    ("dataId".to_string(), key.data_id),
                    ("group".to_string(), key.group),
                    ("tenant".to_string(), namespace),
                ],
                None,
                None,
            )
            .await?;
        error_for_status(resp, "/v1/cs/configs").await?;
        Ok(())
    }

    async fn list_services(&self, query: NacosServiceQuery) -> Result<NacosServiceList, String> {
        let page_no = query.page_no.unwrap_or(1).max(1);
        let page_size = query.page_size.unwrap_or(self.cfg.page_size).clamp(1, 500);
        let namespace = self.namespace(query.namespace.as_deref());
        let mut params = vec![
            ("namespaceId".to_string(), namespace),
            ("pageNo".to_string(), page_no.to_string()),
            ("pageSize".to_string(), page_size.to_string()),
        ];
        push_optional(&mut params, "groupName", query.group_name);
        push_optional(&mut params, "serviceNameParam", query.service_name);
        let value = self.get_json("/v1/ns/service/list", params).await?;
        Ok(parse_service_list(value, page_no, page_size))
    }

    async fn list_instances(&self, query: NacosInstanceQuery) -> Result<Vec<NacosInstanceInfo>, String> {
        let namespace = self.namespace(query.namespace.as_deref());
        let mut params = vec![("serviceName".to_string(), query.service_name), ("namespaceId".to_string(), namespace)];
        push_optional(&mut params, "groupName", query.group_name);
        push_optional(&mut params, "clusters", query.clusters);
        let value = self.get_json("/v1/ns/instance/list", params).await?;
        Ok(parse_instances(value))
    }

    async fn update_instance(&self, req: NacosInstanceUpdate) -> Result<(), String> {
        let namespace = self.namespace(req.namespace.as_deref());
        let mut form = vec![
            ("serviceName".to_string(), req.service_name),
            ("ip".to_string(), req.ip),
            ("port".to_string(), req.port.to_string()),
            ("namespaceId".to_string(), namespace),
        ];
        push_optional(&mut form, "groupName", req.group_name);
        push_optional(&mut form, "clusterName", req.cluster_name);
        if let Some(value) = req.healthy {
            form.push(("healthy".to_string(), value.to_string()));
        }
        if let Some(value) = req.enabled {
            form.push(("enabled".to_string(), value.to_string()));
        }
        if let Some(value) = req.ephemeral {
            form.push(("ephemeral".to_string(), value.to_string()));
        }
        if let Some(value) = req.weight {
            form.push(("weight".to_string(), value.to_string()));
        }
        if let Some(value) = req.metadata {
            form.push(("metadata".to_string(), value.to_string()));
        }
        let resp = self.request(reqwest::Method::PUT, "/v1/ns/instance", Vec::new(), Some(form), None).await?;
        error_for_status(resp, "/v1/ns/instance").await?;
        Ok(())
    }

    async fn raw_request(&self, req: NacosRawRequest) -> Result<NacosRawResponse, String> {
        let method = reqwest::Method::from_bytes(req.method.to_ascii_uppercase().as_bytes())
            .map_err(|e| format!("Invalid Nacos raw request method: {e}"))?;
        let mut query = req.query.unwrap_or_default().into_iter().collect::<Vec<_>>();
        query.sort_by(|a, b| a.0.cmp(&b.0));
        let resp = self.request(method, &req.path, query, None, req.body).await?;
        let status = resp.status().as_u16();
        let headers = response_headers(resp.headers());
        let bytes = resp.bytes().await.map_err(|e| format!("Failed to read Nacos raw response: {e}"))?;
        if bytes.len() > MAX_RAW_RESPONSE_BYTES {
            return Err(format!("Nacos raw response exceeds {} bytes", MAX_RAW_RESPONSE_BYTES));
        }
        let text = String::from_utf8_lossy(&bytes).to_string();
        let body = serde_json::from_slice::<Value>(&bytes).unwrap_or_else(|_| Value::String(text.clone()));
        Ok(NacosRawResponse { status, body: serde_json::json!({ "headers": headers, "body": body }), text: Some(text) })
    }
}

fn parse_namespaces(value: Value) -> Vec<NacosNamespaceInfo> {
    let items =
        value.get("data").or_else(|| value.get("namespaces")).and_then(Value::as_array).cloned().unwrap_or_default();
    let mut namespaces: Vec<NacosNamespaceInfo> = items
        .into_iter()
        .map(|item| {
            let namespace = optional_string_field(&item, &["namespace", "namespaceId", "tenant"]).unwrap_or_default();
            let show_name = optional_string_field(&item, &["namespaceShowName", "namespaceName", "name"])
                .filter(|value| !value.trim().is_empty())
                .unwrap_or_else(|| if namespace.is_empty() { "public".to_string() } else { namespace.clone() });
            NacosNamespaceInfo {
                namespace,
                namespace_show_name: show_name,
                namespace_desc: optional_string_field(&item, &["namespaceDesc", "description", "desc"]),
                config_count: optional_u64_field(&item, &["configCount"]),
                quota: optional_u64_field(&item, &["quota"]),
                namespace_type: optional_u64_field(&item, &["type", "namespaceType"]),
            }
        })
        .collect();
    if !namespaces.iter().any(|item| item.namespace.is_empty()) {
        namespaces.insert(
            0,
            NacosNamespaceInfo {
                namespace: String::new(),
                namespace_show_name: "public".to_string(),
                namespace_desc: None,
                config_count: None,
                quota: None,
                namespace_type: None,
            },
        );
    }
    namespaces
}

fn normalize_api_path(path: &str) -> String {
    let trimmed = path.trim();
    if trimmed.starts_with('/') {
        trimmed.to_string()
    } else {
        format!("/{trimmed}")
    }
}

fn push_optional(params: &mut Vec<(String, String)>, key: &str, value: Option<String>) {
    if let Some(value) = value.map(|v| v.trim().to_string()).filter(|v| !v.is_empty()) {
        params.push((key.to_string(), value));
    }
}

async fn response_json_or_text(resp: reqwest::Response) -> Result<Value, String> {
    let bytes = resp.bytes().await.map_err(|e| format!("Failed to read Nacos response: {e}"))?;
    if bytes.is_empty() {
        return Ok(Value::Null);
    }
    Ok(serde_json::from_slice(&bytes).unwrap_or_else(|_| Value::String(String::from_utf8_lossy(&bytes).to_string())))
}

async fn error_for_status(resp: reqwest::Response, path: &str) -> Result<reqwest::Response, String> {
    let status = resp.status();
    if status.is_success() {
        return Ok(resp);
    }
    let detail = resp.text().await.unwrap_or_default();
    Err(format!("Nacos admin {path} returned {status}: {}", detail.trim()))
}

fn extract_server_version(raw: &Value) -> Option<String> {
    raw.get("version")
        .or_else(|| raw.get("serverVersion"))
        .or_else(|| raw.pointer("/servers/0/version"))
        .and_then(Value::as_str)
        .map(str::to_string)
}

fn parse_config_list(value: Value, namespace: String, page_no: u32, page_size: u32) -> NacosConfigList {
    let total_count = value.get("totalCount").or_else(|| value.get("total")).and_then(Value::as_u64).unwrap_or(0);
    let items = value
        .get("pageItems")
        .or_else(|| value.get("items"))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .map(|item| NacosConfigItem {
            data_id: string_field(&item, &["dataId", "data_id"]),
            group: string_field(&item, &["group", "groupName"]),
            namespace: string_field(&item, &["tenant", "namespaceId"]).if_empty(&namespace),
            app_name: optional_string_field(&item, &["appName", "app_name"]),
            desc: optional_string_field(&item, &["desc", "description"]),
            config_type: optional_string_field(&item, &["type", "configType"]),
            md5: optional_string_field(&item, &["md5"]),
            encrypted_data_key: optional_string_field(&item, &["encryptedDataKey"]),
            content: optional_string_field(&item, &["content"]),
        })
        .collect();
    NacosConfigList { page_no, page_size, total_count, items }
}

fn parse_service_list(value: Value, page_no: u32, page_size: u32) -> NacosServiceList {
    let total_count = value.get("count").or_else(|| value.get("totalCount")).and_then(Value::as_u64).unwrap_or(0);
    let items_value = value.get("doms").or_else(|| value.get("services")).or_else(|| value.get("pageItems"));
    let items = items_value
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .map(|item| {
            if let Some(name) = item.as_str() {
                NacosServiceInfo {
                    service_name: name.to_string(),
                    group_name: None,
                    cluster_count: None,
                    ip_count: None,
                    healthy_instance_count: None,
                    trigger_flag: None,
                }
            } else {
                NacosServiceInfo {
                    service_name: string_field(&item, &["name", "serviceName"]),
                    group_name: optional_string_field(&item, &["groupName"]),
                    cluster_count: optional_u64_field(&item, &["clusterCount"]),
                    ip_count: optional_u64_field(&item, &["ipCount"]),
                    healthy_instance_count: optional_u64_field(&item, &["healthyInstanceCount"]),
                    trigger_flag: optional_string_field(&item, &["triggerFlag"]),
                }
            }
        })
        .collect();
    NacosServiceList { page_no, page_size, total_count, items }
}

fn parse_instances(value: Value) -> Vec<NacosInstanceInfo> {
    value
        .get("hosts")
        .or_else(|| value.get("instances"))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .map(|item| NacosInstanceInfo {
            ip: string_field(&item, &["ip"]),
            port: item.get("port").and_then(Value::as_u64).unwrap_or(0) as u16,
            service_name: optional_string_field(&item, &["serviceName"]),
            cluster_name: optional_string_field(&item, &["clusterName"]),
            group_name: optional_string_field(&item, &["groupName"]),
            healthy: item.get("healthy").and_then(Value::as_bool),
            enabled: item.get("enabled").and_then(Value::as_bool),
            ephemeral: item.get("ephemeral").and_then(Value::as_bool),
            weight: item.get("weight").and_then(Value::as_f64),
            metadata: item.get("metadata").cloned().unwrap_or(Value::Null),
        })
        .collect()
}

fn string_field(value: &Value, keys: &[&str]) -> String {
    optional_string_field(value, keys).unwrap_or_default()
}

fn optional_string_field(value: &Value, keys: &[&str]) -> Option<String> {
    keys.iter()
        .find_map(|key| value.get(*key))
        .and_then(|value| {
            value
                .as_str()
                .map(str::to_string)
                .or_else(|| value.as_i64().map(|v| v.to_string()))
                .or_else(|| value.as_u64().map(|v| v.to_string()))
        })
        .filter(|value| !value.is_empty())
}

fn optional_u64_field(value: &Value, keys: &[&str]) -> Option<u64> {
    keys.iter().find_map(|key| value.get(*key)).and_then(Value::as_u64)
}

fn response_headers(headers: &HeaderMap) -> HashMap<String, String> {
    headers
        .iter()
        .filter_map(|(name, value): (&reqwest::header::HeaderName, &HeaderValue)| {
            value.to_str().ok().map(|value| (name.as_str().to_string(), value.to_string()))
        })
        .collect()
}

trait EmptyFallback {
    fn if_empty(self, fallback: &str) -> String;
}

impl EmptyFallback for String {
    fn if_empty(self, fallback: &str) -> String {
        if self.trim().is_empty() {
            fallback.to_string()
        } else {
            self
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_config_list_shapes() {
        let parsed = parse_config_list(
            serde_json::json!({
                "totalCount": 1,
                "pageItems": [{ "dataId": "app.yaml", "group": "DEFAULT_GROUP", "type": "yaml" }]
            }),
            "public".to_string(),
            1,
            20,
        );
        assert_eq!(parsed.total_count, 1);
        assert_eq!(parsed.items[0].data_id, "app.yaml");
        assert_eq!(parsed.items[0].namespace, "public");
    }

    #[test]
    fn parses_service_list_string_shape() {
        let parsed = parse_service_list(serde_json::json!({ "count": 1, "doms": ["DEFAULT_GROUP@@svc"] }), 1, 20);
        assert_eq!(parsed.items[0].service_name, "DEFAULT_GROUP@@svc");
    }

    #[test]
    fn parses_namespace_list_shape() {
        let parsed = parse_namespaces(serde_json::json!({
            "code": 200,
            "data": [
                { "namespace": "", "namespaceShowName": "public", "configCount": 2 },
                { "namespace": "dev", "namespaceShowName": "Development", "namespaceDesc": "dev ns" }
            ]
        }));
        assert_eq!(parsed[0].namespace_show_name, "public");
        assert_eq!(parsed[1].namespace, "dev");
        assert_eq!(parsed[1].namespace_desc.as_deref(), Some("dev ns"));
    }
}
