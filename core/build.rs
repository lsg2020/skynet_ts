extern crate libc;
#[macro_use]
extern crate log;
#[macro_use]
extern crate lazy_static;

mod bindings;
pub mod error;
mod gotham_state;
mod modules;
mod ops;
mod resources;
mod runtime;
mod zero_copy_buf;
mod inspector;

pub use futures;
pub use rusty_v8 as v8;
pub use serde;
pub use serde_json;

pub use crate::ops::json_op_sync;
pub use crate::ops::OpFn;
pub use crate::ops::OpId;
pub use crate::ops::OpState;
pub use crate::ops::OpTable;
pub use crate::resources::ResourceTable;
pub use crate::runtime::GetErrorClassFn;
pub use crate::runtime::HeapLimits;
pub use crate::runtime::JsRuntime;
pub use crate::runtime::JsRuntimeState;
pub use crate::runtime::RuntimeOptions;
pub use crate::runtime::Snapshot;
pub use crate::zero_copy_buf::BufVec;
pub use crate::zero_copy_buf::ZeroCopyBuf;

use std::env;
use std::path::Path;
use std::path::PathBuf;

fn create_snapshot(mut js_runtime: Box<JsRuntime>, snapshot_path: &Path, files: Vec<String>) {
    for file in files {
        println!("cargo:rerun-if-changed={}", file);
        js_runtime
            .execute(&file, &std::fs::read_to_string(&file).unwrap())
            .expect(format!("load runtime:{:?} error:", file).as_str());
    }

    let snapshot = js_runtime.snapshot();
    let snapshot_slice: &[u8] = &*snapshot;
    println!("Snapshot size: {}", snapshot_slice.len());
    std::fs::write(&snapshot_path, snapshot_slice).unwrap();
    println!("Snapshot written to: {} ", snapshot_path.display());
}

fn create_runtime_snapshot(snapshot_path: &Path, files: Vec<String>) {
    let runtime_isolate = JsRuntime::new(RuntimeOptions {
        will_snapshot: true,
        ..Default::default()
    });
    create_snapshot(runtime_isolate, snapshot_path, files);
}

fn main() {
    // Don't build V8 if "cargo doc" is being run. This is to support docs.rs.
    if env::var_os("RUSTDOCFLAGS").is_some() {
        return;
    }

    // To debug snapshot issues uncomment:
    // op_fetch_asset::trace_serializer();

    println!(
        "cargo:rustc-env=TARGET={}",
        std::env::var("TARGET").unwrap()
    );

    let o = PathBuf::from(env::var_os("OUT_DIR").unwrap());

    // Main snapshot
    let runtime_snapshot_path = o.join("CLI_SNAPSHOT.bin");

    let js_files = get_js_files("rt");
    create_runtime_snapshot(&runtime_snapshot_path, js_files);
}

fn get_js_files(d: &str) -> Vec<String> {
    let mut js_files = std::fs::read_dir(d)
        .unwrap()
        .map(|dir_entry| {
            let file = dir_entry.unwrap();
            file.path().to_string_lossy().to_string()
        })
        .filter(|filename| filename.ends_with(".js"))
        .collect::<Vec<String>>();
    js_files.sort();
    js_files
}
