use std::time::Duration;

use dbx_core::db::mongo_driver;

#[tokio::test]
#[ignore = "requires DBX_LIVE_MONGODB_URL plus DBX_LIVE_MONGODB_USERNAME and DBX_LIVE_MONGODB_PASSWORD"]
async fn runtime_credentials_authenticate_when_uri_has_no_password() {
    let url = std::env::var("DBX_LIVE_MONGODB_URL").expect("DBX_LIVE_MONGODB_URL");
    let username = std::env::var("DBX_LIVE_MONGODB_USERNAME").expect("DBX_LIVE_MONGODB_USERNAME");
    let password = std::env::var("DBX_LIVE_MONGODB_PASSWORD").expect("DBX_LIVE_MONGODB_PASSWORD");
    let timeout = Duration::from_secs(10);

    let client =
        mongo_driver::connect_with_password_policy(&url, timeout, Duration::from_secs(60), false, &username, &password)
            .await
            .expect("runtime credentials should authenticate");

    mongo_driver::test_connection(&client, timeout, None).await.expect("authenticated ping should succeed");
}
use mongodb::bson::{doc, Bson, DateTime};

#[tokio::test]
#[ignore = "requires DBX_LIVE_MONGODB_URL pointing at a writable MongoDB database"]
async fn find_one_returns_only_the_sorted_document() {
    let url = std::env::var("DBX_LIVE_MONGODB_URL").expect("DBX_LIVE_MONGODB_URL");
    let client = mongo_driver::connect(&url, Duration::from_secs(10), Duration::from_secs(60)).await.unwrap();
    let database = "dbx_live_find_one";
    let collection = format!("items_{}", std::process::id());

    mongo_driver::insert_documents(
        &client,
        database,
        &collection,
        r#"[{"name":"old","rank":1},{"name":"new","rank":2}]"#,
    )
    .await
    .unwrap();

    let result = mongo_driver::find_one(
        &client,
        database,
        &collection,
        Some("{}"),
        Some(r#"{"_id":0,"name":1}"#),
        Some(r#"{"sort":{"rank":-1}}"#),
    )
    .await
    .unwrap();

    assert_eq!(result.total, 1);
    assert_eq!(result.documents, vec![serde_json::json!({ "name": "new" })]);
    mongo_driver::drop_collection(&client, database, &collection).await.unwrap();
}

#[tokio::test]
#[ignore = "requires DBX_LIVE_MONGODB_URL pointing at a writable MongoDB database"]
async fn find_documents_returns_type_preserving_copy_documents() {
    let url = std::env::var("DBX_LIVE_MONGODB_URL").expect("DBX_LIVE_MONGODB_URL");
    let client = mongo_driver::connect(&url, Duration::from_secs(10), Duration::from_secs(60)).await.unwrap();
    let database = "dbx_live_find_one";
    let collection = format!("copy_types_{}", std::process::id());

    client
        .database(database)
        .collection(&collection)
        .insert_one(doc! {
            "lastUpdatedDate": DateTime::parse_rfc3339_str("2025-05-06T08:35:32Z").unwrap(),
            "dateText": Bson::String("ISODate(\"2025-05-06T08:35:32Z\")".to_string()),
        })
        .await
        .unwrap();

    let result =
        mongo_driver::find_documents(&client, database, &collection, 0, 10, Some("{}"), Some(r#"{"_id":0}"#), None)
            .await
            .unwrap();

    assert_eq!(result.documents[0]["lastUpdatedDate"], serde_json::json!("ISODate(\"2025-05-06T08:35:32Z\")"));
    let extended = result.extended_documents.expect("extended documents");
    assert_eq!(extended[0]["lastUpdatedDate"], serde_json::json!({ "$date": "2025-05-06T08:35:32Z" }));
    assert_eq!(extended[0]["dateText"], serde_json::json!("ISODate(\"2025-05-06T08:35:32Z\")"));

    mongo_driver::drop_collection(&client, database, &collection).await.unwrap();
}
