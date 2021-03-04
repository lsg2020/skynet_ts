// Copyright 2018-2020 the Deno authors. All rights reserved. MIT license.

use rusty_v8 as v8;

use crate::bindings;
use crate::error::attach_handle_to_error;
use crate::error::AnyError;
use crate::error::ErrWithV8Handle;
use crate::error::JsError;

use crate::inspector::Inspector;
use crate::modules::ModuleId;
use crate::modules::ModuleSource;
use crate::modules::ModuleSpecifier;
use crate::modules::Modules;
use crate::ops::OpId;
use crate::OpState;

use libc::{c_int, c_void};
use std::any::Any;
use std::cell::RefCell;
use std::collections::HashMap;
use std::convert::TryFrom;
use std::mem::forget;
use std::option::Option;
use std::rc::Rc;
use std::sync::Once;

use std::path::Component;
use std::path::Path;
use std::path::PathBuf;
use byteorder::{ByteOrder, LittleEndian};

pub enum Snapshot {
    Static(&'static [u8]),
    JustCreated(v8::StartupData),
    Boxed(Box<[u8]>),
}

type JsErrorCreateFn = dyn Fn(JsError) -> AnyError;

pub type GetErrorClassFn = &'static dyn for<'e> Fn(&'e AnyError) -> &'static str;

/// Objects that need to live as long as the isolate
#[derive(Default)]
struct IsolateAllocations {
    near_heap_limit_callback_data: Option<(Box<RefCell<dyn Any>>, v8::NearHeapLimitCallback)>,
}

pub struct JsRuntime {
    v8_isolate: Option<v8::OwnedIsolate>,
    snapshot_creator: Option<v8::SnapshotCreator>,
    has_snapshotted: bool,
    allocations: IsolateAllocations,
    pub custom_archive: *mut c_void,
    pub inspector_session_len: usize,
    pub empty_archive: *mut c_void,
}

pub struct JsRuntimeState {
    pub global_context: Option<v8::Global<v8::Context>>,
    pub(crate) js_recv_cb: Option<v8::Global<v8::Function>>,
    pub(crate) js_macrotask_cb: Option<v8::Global<v8::Function>>,
    pub(crate) pending_promise_exceptions: HashMap<i32, v8::Global<v8::Value>>,
    pub(crate) js_error_create_fn: Box<JsErrorCreateFn>,
    pub(crate) op_state: Rc<RefCell<OpState>>,
    pub modules: Modules,
    pub(crate) dyn_import_list: Vec<(v8::Global<v8::PromiseResolver>, String, String)>,
    pub shared_bs: Option<v8::SharedRef<v8::BackingStore>>,
    pub module_search_paths: Vec<String>,
    pub module_resolve: HashMap<String, String>,
    pub inspector: Option<Box<Inspector>>,
    pub runtime: *mut JsRuntime,
}

impl Drop for JsRuntime {
    fn drop(&mut self) {
        if let Some(creator) = self.snapshot_creator.take() {
            let v8_isolate = self.v8_isolate.take().unwrap();
            forget(v8_isolate);

            if self.has_snapshotted {
                drop(creator);
            }
        }

        unsafe { libc::free(self.custom_archive) };
        self.custom_archive = std::ptr::null_mut();
    }
}

#[allow(clippy::missing_safety_doc)]
pub unsafe fn v8_init() {
    let platform = v8::new_default_platform().unwrap();
    v8::V8::initialize_platform(platform);
    v8::V8::initialize();
    let argv = vec![
        "".to_string(),
        "--wasm-test-streaming".to_string(),
        "--no-wasm-async-compilation".to_string(),
        "--harmony-top-level-await".to_string(),
    ];
    v8::V8::set_flags_from_command_line(argv);
}

pub struct HeapLimits {
    pub initial: usize,
    pub max: usize,
}

#[derive(Default)]
pub struct RuntimeOptions {
    pub js_error_create_fn: Option<Box<JsErrorCreateFn>>,

    pub startup_snapshot: Option<Snapshot>,

    pub will_snapshot: bool,

    pub heap_limits: Option<HeapLimits>,
}

pub struct IsolateAutoCheck(*mut v8::Isolate);
impl IsolateAutoCheck {
    pub fn new(isolate: &mut v8::Isolate) -> Self {
        Self(isolate)
    }
}

impl Drop for IsolateAutoCheck {
    fn drop(&mut self) {
        let isolate = unsafe { &mut *self.0 };
        let _ = v8::HandleScope::new(isolate);
    }
}

impl JsRuntime {
    pub fn new(options: RuntimeOptions) -> Box<Self> {
        static DENO_INIT: Once = Once::new();
        DENO_INIT.call_once(|| {
            unsafe { v8_init() };
        });

        let global_context;
        let (isolate, maybe_snapshot_creator) = if options.will_snapshot {
            // TODO(ry) Support loading snapshots before snapshotting.
            assert!(options.startup_snapshot.is_none());
            let mut creator = v8::SnapshotCreator::new(Some(&bindings::EXTERNAL_REFERENCES));
            let isolate = unsafe { creator.get_owned_isolate() };
            let mut isolate = JsRuntime::setup_isolate(isolate);
            {
                let scope = &mut v8::HandleScope::new(&mut isolate);
                let context = bindings::initialize_context(scope);
                global_context = v8::Global::new(scope, context);
                creator.set_default_context(context);
            }
            (isolate, Some(creator))
        } else {
            let mut params =
                v8::Isolate::create_params().external_references(&**bindings::EXTERNAL_REFERENCES);
            let snapshot_loaded = if let Some(snapshot) = options.startup_snapshot {
                params = match snapshot {
                    Snapshot::Static(data) => params.snapshot_blob(data),
                    Snapshot::JustCreated(data) => params.snapshot_blob(data),
                    Snapshot::Boxed(data) => params.snapshot_blob(data),
                };
                true
            } else {
                false
            };

            if let Some(heap_limits) = options.heap_limits {
                params = params.heap_limits(heap_limits.initial, heap_limits.max)
            }

            let isolate = v8::Isolate::new(params);
            let mut isolate = JsRuntime::setup_isolate(isolate);
            {
                let _isolate_scope = v8::IsolateScope::new(&mut isolate);
                let _locker = v8::Locker::new(&mut isolate, std::ptr::null_mut());
                let _auto_check = IsolateAutoCheck::new(&mut isolate);
                let scope = &mut v8::HandleScope::new(&mut isolate);
                let context = if snapshot_loaded {
                    v8::Context::new(scope)
                } else {
                    // If no snapshot is provided, we initialize the context with empty
                    // main source code and source maps.
                    bindings::initialize_context(scope)
                };
                global_context = v8::Global::new(scope, context);
            }
            (isolate, None)
        };

        let js_error_create_fn = options
            .js_error_create_fn
            .unwrap_or_else(|| Box::new(JsError::create));
        let op_state = OpState::default();

        let custom_archive = unsafe {
            let p = libc::malloc(1024);
            libc::memset(p, 0, 1024);
            p
        };
        let runtime = Box::new(Self {
            v8_isolate: Some(isolate),
            snapshot_creator: maybe_snapshot_creator,
            has_snapshotted: false,
            allocations: IsolateAllocations::default(),
            custom_archive: custom_archive,
            inspector_session_len: 0,
            empty_archive: std::ptr::null_mut(),
        });
        let runtime = Box::into_raw(runtime);

        let state = JsRuntimeState {
            global_context: Some(global_context),
            pending_promise_exceptions: HashMap::new(),
            js_recv_cb: None,
            js_macrotask_cb: None,
            js_error_create_fn,
            op_state: Rc::new(RefCell::new(op_state)),
            modules: Modules::new(),
            dyn_import_list: Vec::new(),
            shared_bs: None,
            module_search_paths: Vec::new(),
            module_resolve: HashMap::new(),
            inspector: None,
            runtime: runtime,
        };

        let mut runtime = unsafe { Box::from_raw(runtime) };
        runtime.v8_isolate().set_slot(Rc::new(RefCell::new(state)));
        runtime
    }

    pub fn global_context(&mut self) -> v8::Global<v8::Context> {
        let state = Self::state(self.v8_isolate());
        let state = state.borrow();
        state.global_context.clone().unwrap()
    }

    pub fn v8_isolate(&mut self) -> &mut v8::OwnedIsolate {
        self.v8_isolate.as_mut().unwrap()
    }

    fn setup_isolate(mut isolate: v8::OwnedIsolate) -> v8::OwnedIsolate {
        isolate.set_capture_stack_trace_for_uncaught_exceptions(true, 10);
        isolate.set_promise_reject_callback(bindings::promise_reject_callback);
        isolate.set_host_initialize_import_meta_object_callback(
            bindings::host_initialize_import_meta_object_callback,
        );
        isolate.set_host_import_module_dynamically_callback(
            bindings::host_import_module_dynamically_callback,
        );

        isolate
    }

    pub fn register_op<F>(&mut self, name: &str, op_fn: F) -> OpId
    where
        F: Fn(
                Rc<RefCell<OpState>>,
                &mut JsRuntimeState,
                &mut v8::HandleScope,
                v8::FunctionCallbackArguments,
                v8::ReturnValue,
            ) + 'static,
    {
        Self::state(self.v8_isolate())
            .borrow_mut()
            .op_state
            .borrow_mut()
            .op_table
            .register_op(name, op_fn)
    }

    pub(crate) fn state(isolate: &v8::Isolate) -> Rc<RefCell<JsRuntimeState>> {
        let s = isolate.get_slot::<Rc<RefCell<JsRuntimeState>>>().unwrap();
        s.clone()
    }

    pub fn op_state(&mut self) -> Rc<RefCell<OpState>> {
        let state_rc = Self::state(self.v8_isolate());
        let state = state_rc.borrow();
        state.op_state.clone()
    }

    /// Executes traditional JavaScript code (traditional = not ES modules)
    ///
    /// `AnyError` can be downcast to a type that exposes additional information
    /// about the V8 exception. By default this type is `JsError`, however it may
    /// be a different type if `RuntimeOptions::js_error_create_fn` has been set.
    pub fn execute(&mut self, js_filename: &str, js_source: &str) -> Result<bool, AnyError> {
        let context = self.global_context();

        let scope = &mut v8::HandleScope::with_context(self.v8_isolate(), context);

        let source = v8::String::new(scope, js_source).unwrap();
        let name = v8::String::new(scope, js_filename).unwrap();
        let origin = bindings::script_origin(scope, name);

        let tc_scope = &mut v8::TryCatch::new(scope);

        let script = match v8::Script::compile(tc_scope, source, Some(&origin)) {
            Some(script) => script,
            None => {
                let exception = tc_scope.exception().unwrap();
                return exception_to_err_result(tc_scope, exception);
            }
        };

        match script.run(tc_scope) {
            Some(_) => Ok(true),
            None => {
                assert!(tc_scope.has_caught());
                let exception = tc_scope.exception().unwrap();
                exception_to_err_result(tc_scope, exception)
            }
        }
    }

    /// Takes a snapshot. The isolate should have been created with will_snapshot
    /// set to true.
    ///
    /// `AnyError` can be downcast to a type that exposes additional information
    /// about the V8 exception. By default this type is `JsError`, however it may
    /// be a different type if `RuntimeOptions::js_error_create_fn` has been set.
    pub fn snapshot(&mut self) -> v8::StartupData {
        assert!(self.snapshot_creator.is_some());
        let state = Self::state(self.v8_isolate());

        // Note: create_blob() method must not be called from within a HandleScope.
        // TODO(piscisaureus): The rusty_v8 type system should enforce this.
        state.borrow_mut().global_context.take();

        std::mem::take(&mut state.borrow_mut().modules);

        let snapshot_creator = self.snapshot_creator.as_mut().unwrap();
        let snapshot = snapshot_creator
            .create_blob(v8::FunctionCodeHandling::Keep)
            .unwrap();
        self.has_snapshotted = true;

        snapshot
    }

    /// Registers a callback on the isolate when the memory limits are approached.
    /// Use this to prevent V8 from crashing the process when reaching the limit.
    ///
    /// Calls the closure with the current heap limit and the initial heap limit.
    /// The return value of the closure is set as the new limit.
    pub fn add_near_heap_limit_callback<C>(&mut self, cb: C)
    where
        C: FnMut(usize, usize) -> usize + 'static,
    {
        let boxed_cb = Box::new(RefCell::new(cb));
        let data = boxed_cb.as_ptr() as *mut c_void;

        let prev = self
            .allocations
            .near_heap_limit_callback_data
            .replace((boxed_cb, near_heap_limit_callback::<C>));
        if let Some((_, prev_cb)) = prev {
            self.v8_isolate()
                .remove_near_heap_limit_callback(prev_cb, 0);
        }

        self.v8_isolate()
            .add_near_heap_limit_callback(near_heap_limit_callback::<C>, data);
    }

    pub fn remove_near_heap_limit_callback(&mut self, heap_limit: usize) {
        if let Some((_, cb)) = self.allocations.near_heap_limit_callback_data.take() {
            self.v8_isolate()
                .remove_near_heap_limit_callback(cb, heap_limit);
        }
    }
}

extern "C" fn near_heap_limit_callback<F>(
    data: *mut c_void,
    current_heap_limit: usize,
    initial_heap_limit: usize,
) -> usize
where
    F: FnMut(usize, usize) -> usize,
{
    let callback = unsafe { &mut *(data as *mut F) };
    callback(current_heap_limit, initial_heap_limit)
}

impl JsRuntimeState {
    // Called by V8 during `Isolate::mod_instantiate`.
    pub fn module_resolve_cb(&mut self, specifier: &str, referrer_id: ModuleId) -> ModuleId {
        let referrer = self.modules.get_name(referrer_id).unwrap();
        let specifier =
            JsRuntime::module_resolve(&specifier.to_owned(), &Some(referrer.clone()), self);
        self.modules.get_id(specifier.as_str()).unwrap_or(0)
    }

    pub fn dyn_import_cb(
        &mut self,
        resolver_handle: v8::Global<v8::PromiseResolver>,
        specifier: &str,
        referrer: &str,
    ) {
        self.dyn_import_list
            .push((resolver_handle, specifier.to_owned(), referrer.to_owned()));
    }
}

pub(crate) fn exception_to_err_result<'s, T>(
    scope: &mut v8::HandleScope<'s>,
    exception: v8::Local<v8::Value>,
) -> Result<T, AnyError> {
    // TODO(piscisaureus): in rusty_v8, `is_execution_terminating()` should
    // also be implemented on `struct Isolate`.
    let is_terminating_exception = scope.thread_safe_handle().is_execution_terminating();
    let mut exception = exception;

    if is_terminating_exception {
        // TerminateExecution was called. Cancel exception termination so that the
        // exception can be created..
        // TODO(piscisaureus): in rusty_v8, `cancel_terminate_execution()` should
        // also be implemented on `struct Isolate`.
        scope.thread_safe_handle().cancel_terminate_execution();

        // Maybe make a new exception object.
        if exception.is_null_or_undefined() {
            let message = v8::String::new(scope, "execution terminated").unwrap();
            exception = v8::Exception::error(scope, message);
        }
    }

    let js_error = JsError::from_v8_exception(scope, exception);

    let state_rc = JsRuntime::state(scope);
    let state = state_rc.borrow();
    let js_error = (state.js_error_create_fn)(js_error);

    if is_terminating_exception {
        // Re-enable exception termination.
        // TODO(piscisaureus): in rusty_v8, `terminate_execution()` should also
        // be implemented on `struct Isolate`.
        scope.thread_safe_handle().terminate_execution();
    }

    Err(js_error)
}

// Related to module loading
impl JsRuntime {
    /// Low-level module creation.
    ///
    /// Called during module loading or dynamic import loading.
    fn mod_new(&mut self, main: bool, name: &str, source: &str) -> Result<ModuleId, AnyError> {
        let state_rc = Self::state(self.v8_isolate());
        let context = self.global_context();
        let scope = &mut v8::HandleScope::with_context(self.v8_isolate(), context);

        let name_str = v8::String::new(scope, name).unwrap();
        let source_str = v8::String::new(scope, source).unwrap();

        let origin = bindings::module_origin(scope, name_str);
        let source = v8::script_compiler::Source::new(source_str, &origin);

        let tc_scope = &mut v8::TryCatch::new(scope);

        let maybe_module = v8::script_compiler::compile_module(tc_scope, source);

        if tc_scope.has_caught() {
            assert!(maybe_module.is_none());
            let e = tc_scope.exception().unwrap();
            return exception_to_err_result(tc_scope, e);
        }

        let module = maybe_module.unwrap();
        let id = module.get_identity_hash();

        let mut state = state_rc.borrow_mut();
        let mut import_specifiers: Vec<ModuleSpecifier> = vec![];
        let module_requests = module.get_module_requests();
        for i in 0..module_requests.length() {
            let module_request = v8::Local::<v8::ModuleRequest>::try_from(
                module_requests.get(tc_scope, i).unwrap(),
            ).unwrap();
            let import_specifier = module_request.get_specifier().to_rust_string_lossy(tc_scope);
            // let module_specifier = Self::module_resolve(&import_specifier, &Some(name.to_owned()), &mut state);
            import_specifiers.push(ModuleSpecifier::new(import_specifier));
        }

        state.modules.register(
            id,
            name,
            main,
            v8::Global::<v8::Module>::new(tc_scope, module),
            import_specifiers,
        );

        Ok(id)
    }

    /// Instantiates a ES module
    ///
    /// `AnyError` can be downcast to a type that exposes additional information
    /// about the V8 exception. By default this type is `JsError`, however it may
    /// be a different type if `RuntimeOptions::js_error_create_fn` has been set.
    fn mod_instantiate(&mut self, id: ModuleId) -> Result<bool, AnyError> {
        let state_rc = Self::state(self.v8_isolate());
        let context = self.global_context();

        let scope = &mut v8::HandleScope::with_context(self.v8_isolate(), context);
        let tc_scope = &mut v8::TryCatch::new(scope);

        let state = state_rc.borrow();
        let module = match state.modules.get_info(id) {
            Some(info) => v8::Local::new(tc_scope, &info.handle),
            None if id == 0 => return Ok(true),
            _ => panic!("module id {} not found in module table", id),
        };
        drop(state);

        if module.get_status() == v8::ModuleStatus::Errored {
            exception_to_err_result(tc_scope, module.get_exception())?
        }

        let result = module.instantiate_module(tc_scope, bindings::module_resolve_callback);
        match result {
            Some(_) => Ok(true),
            None => {
                let exception = tc_scope.exception().unwrap();
                exception_to_err_result(tc_scope, exception)
            }
        }
    }

    /// Evaluates an already instantiated ES module.
    ///
    /// `AnyError` can be downcast to a type that exposes additional information
    /// about the V8 exception. By default this type is `JsError`, however it may
    /// be a different type if `RuntimeOptions::js_error_create_fn` has been set.
    pub fn mod_evaluate(&mut self, id: ModuleId) -> Result<bool, AnyError> {
        let state_rc = Self::state(self.v8_isolate());
        let context = self.global_context();

        let scope = &mut v8::HandleScope::with_context(self.v8_isolate(), context);

        let module = state_rc
            .borrow()
            .modules
            .get_info(id)
            .map(|info| v8::Local::new(scope, &info.handle))
            .expect("ModuleInfo not found");
        let mut status = module.get_status();

        if status == v8::ModuleStatus::Instantiated {
            // IMPORTANT: Top-level-await is enabled, which means that return value
            // of module evaluation is a promise.
            //
            // Because that promise is created internally by V8, when error occurs during
            // module evaluation the promise is rejected, and since the promise has no rejection
            // handler it will result in call to `bindings::promise_reject_callback` adding
            // the promise to pending promise rejection table - meaning JsRuntime will return
            // error on next poll().
            //
            // This situation is not desirable as we want to manually return error at the
            // end of this function to handle it further. It means we need to manually
            // remove this promise from pending promise rejection table.
            //
            // For more details see:
            // https://github.com/denoland/deno/issues/4908
            // https://v8.dev/features/top-level-await#module-execution-order
            let maybe_value = module.evaluate(scope);

            // Update status after evaluating.
            status = module.get_status();

            if let Some(value) = maybe_value {
                assert!(
                    status == v8::ModuleStatus::Evaluated || status == v8::ModuleStatus::Errored
                );
                let promise = v8::Local::<v8::Promise>::try_from(value)
                    .expect("Expected to get promise as module evaluation result");
                let promise_id = promise.get_identity_hash();
                let mut state = state_rc.borrow_mut();
                state.pending_promise_exceptions.remove(&promise_id);
            } else {
                assert!(status == v8::ModuleStatus::Errored);
            }
        }

        match status {
            v8::ModuleStatus::Evaluated => Ok(true),
            v8::ModuleStatus::Errored => {
                let exception = module.get_exception();
                exception_to_err_result(scope, exception)
                    .map_err(|err| attach_handle_to_error(scope, err, exception))
            }
            other => panic!("Unexpected module status {:?}", other),
        }
    }

    fn register_during_load(
        &mut self,
        info: ModuleSource,
        import_specifiers: &mut Vec<(String, Option<String>)>,
    ) -> Result<ModuleId, AnyError> {
        let ModuleSource {
            code,
            module_url_specified,
            module_url_found,
        } = info;

        let state_rc = Self::state(self.v8_isolate());
        // If necessary, register an alias.
        if module_url_specified != module_url_found {
            let mut state = state_rc.borrow_mut();
            state
                .modules
                .alias(&module_url_specified, &module_url_found);
        }

        let maybe_mod_id = {
            let state = state_rc.borrow();
            state.modules.get_id(&module_url_found)
        };

        let module_id = match maybe_mod_id {
            Some(id) => {
                // Module has already been registered.
                debug!(
                    "Already-registered module fetched again: {}",
                    module_url_found
                );
                id
            }
            // Module not registered yet, do it now.
            None => self.mod_new(false, &module_url_found, &code)?,
        };

        // Now we must iterate over all imports of the module and load them.
        let imports = {
            let state_rc = Self::state(self.v8_isolate());
            let state = state_rc.borrow();
            state.modules.get_children(module_id).unwrap().clone()
        };

        for module_specifier in imports {
            let is_registered = {
                let state_rc = Self::state(self.v8_isolate());
                let state = state_rc.borrow();
                state.modules.is_registered(&module_specifier)
            };
            if !is_registered {
                import_specifiers.push((
                    module_specifier.as_str().to_owned(),
                    Some(String::from(&module_url_specified)),
                ));
            }
        }

        Ok(module_id)
    }

    fn module_resolve(
        specifier: &String,
        referrer: &Option<String>,
        state: &mut JsRuntimeState,
    ) -> String {
        for search_path in &state.module_search_paths {
            let search_path = search_path.replace("?", specifier);
            let cache_resolve = state.module_resolve.get(&search_path);
            if !cache_resolve.is_none() {
                return search_path;
            }

            if Path::new(&search_path).is_file() {
                state
                    .module_resolve
                    .insert(search_path.to_owned(), "ok".to_owned());
                return search_path;
            }
        }

        match referrer {
            Some(r) => {
                let mut r = PathBuf::from(r);
                r.pop();
                String::from(
                    Self::normalize_path(r.join(specifier).as_path())
                        .to_str()
                        .unwrap()
                        .to_owned(),
                )
            }
            None => specifier.clone(),
        }
    }

    fn normalize_path(path: &Path) -> PathBuf {
        let mut components = path.components().peekable();
        let mut ret = if let Some(c @ Component::Prefix(..)) = components.peek().cloned() {
            components.next();
            PathBuf::from(c.as_os_str())
        } else {
            PathBuf::new()
        };

        for component in components {
            match component {
                Component::Prefix(..) => unreachable!(),
                Component::RootDir => {
                    ret.push(component.as_os_str());
                }
                Component::CurDir => {}
                Component::ParentDir => {
                    ret.pop();
                }
                Component::Normal(c) => {
                    ret.push(c);
                }
            }
        }
        ret
    }

    fn check_promise_exceptions(&mut self) -> Result<bool, AnyError> {
        let state_rc = Self::state(self.v8_isolate());
        let mut state = state_rc.borrow_mut();

        if state.pending_promise_exceptions.is_empty() {
            return Ok(true);
        }

        let key = { *state.pending_promise_exceptions.keys().next().unwrap() };
        let handle = state.pending_promise_exceptions.remove(&key).unwrap();
        drop(state);

        let context = self.global_context();
        let scope = &mut v8::HandleScope::with_context(self.v8_isolate(), context);

        let exception = v8::Local::new(scope, handle);
        exception_to_err_result(scope, exception)
    }

    pub fn load_module(&mut self, file_path: &str) -> Result<ModuleId, AnyError> {
        let module_id = self.import_impl(&file_path.to_owned(), None)?;
        self.check_dyn_import();
        self.check_promise_exceptions()?;
        Ok(module_id)
    }

    fn import_impl(
        &mut self,
        specifier: &String,
        referrer: Option<String>,
    ) -> Result<ModuleId, AnyError> {
        let mut import_specifiers: Vec<(String, Option<String>)> = Vec::new();
        import_specifiers.push((specifier.to_owned(), referrer));

        let mut main_module_id: ModuleId = 0;

        let import_specifiers = &mut import_specifiers;
        while import_specifiers.len() > 0 {
            let (file_path, referrer) = import_specifiers.pop().unwrap();
            let file_path = {
                let state_rc = Self::state(self.v8_isolate());
                let mut state = state_rc.borrow_mut();

                &JsRuntime::module_resolve(&file_path, &referrer, &mut state)
            };

            let source = std::fs::read_to_string(file_path);
            if let Err(err) = source {
                return Err(crate::error::uri_error(format!(
                    "referrer:{:?} file:{} err:{}",
                    referrer, file_path, err
                )));
            }
            let source = source.unwrap();

            let module_id = self.register_during_load(
                ModuleSource {
                    code: source,
                    module_url_specified: file_path.clone(),
                    module_url_found: "file://".to_owned() + &file_path.to_owned(),
                },
                import_specifiers,
            )?;

            if main_module_id == 0 {
                main_module_id = module_id;
            }
        }

        self.mod_instantiate(main_module_id)?;
        self.mod_evaluate(main_module_id)?;
        Ok(main_module_id)
    }

    pub fn check_dyn_import(&mut self) {
        loop {
            let dyn_import = {
                let state_rc = Self::state(self.v8_isolate());
                let mut state = state_rc.borrow_mut();
                state.dyn_import_list.pop()
            };

            if dyn_import.is_none() {
                break;
            }

            let (resolver_handle, specifier, referrer) = dyn_import.unwrap();
            let ret = self.import_impl(&specifier, Some(referrer));

            let state_rc = Self::state(self.v8_isolate());
            let context = self.global_context();
            let scope = &mut v8::HandleScope::with_context(self.v8_isolate(), context);
            let resolver = resolver_handle.get(scope);

            match ret {
                Ok(mod_id) => {
                    let module = {
                        state_rc
                            .borrow_mut()
                            .modules
                            .get_info(mod_id)
                            .map(|info| v8::Local::new(scope, &info.handle))
                            .expect("Dyn import module info not found")
                    };
                    // Resolution success
                    assert_eq!(module.get_status(), v8::ModuleStatus::Evaluated);

                    let module_namespace = module.get_module_namespace();
                    resolver.resolve(scope, module_namespace).unwrap();
                }
                Err(err) => {
                    let exception = err
                        .downcast_ref::<ErrWithV8Handle>()
                        .map(|err| err.get_handle(scope))
                        .unwrap_or_else(|| {
                            let message = err.to_string();
                            let message = v8::String::new(scope, &message).unwrap();
                            v8::Exception::type_error(scope, message)
                        });

                    resolver.reject(scope, exception).unwrap();
                }
            };
        }
    }

    pub fn dispatch(
        &mut self,
        stype: c_int,
        session: c_int,
        source: c_int,
        msg: *const u8,
        sz: usize,
    ) -> Result<bool, AnyError> {
        {
            let state_rc = Self::state(self.v8_isolate());
            let mut state = state_rc.borrow_mut();

            let scope = &mut v8::HandleScope::new(self.v8_isolate());
            let context = state
                .global_context
                .as_ref()
                .map(|context| v8::Local::new(scope, context))
                .unwrap();
            let scope = &mut v8::ContextScope::new(scope, context);

            let tc_scope = &mut v8::TryCatch::new(scope);

            let offset: usize = 64;
            let new_bs = state.get_shared_bs(tc_scope, sz + offset);
            let buf = unsafe {
                let bs = state.shared_bs.as_ref().unwrap();
                bindings::get_backing_store_slice_mut(bs, 0, bs.byte_length())
            };

            let mut index = 0;
            LittleEndian::write_i32(&mut buf[index .. index+4], stype); index = index + 4;
            LittleEndian::write_i32(&mut buf[index .. index+4], session); index = index + 4;
            LittleEndian::write_i32(&mut buf[index .. index+4], source); index = index + 4;
            LittleEndian::write_u32(&mut buf[index .. index+4], sz as u32); index = index + 4;
            LittleEndian::write_u64(&mut buf[index .. index+8], msg as u64);
            if sz > 0 {
                buf[offset .. offset+sz].copy_from_slice(unsafe { std::slice::from_raw_parts(msg, sz) });
            }

            /*
            let v8_msg = v8::BigInt::new_from_u64(tc_scope, msg as u64).into();
            let v8_sz = v8::Integer::new(tc_scope, sz as i32).into();

            let v8_stype = v8::Integer::new(tc_scope, stype as i32).into();
            let v8_session = v8::Integer::new(tc_scope, session as i32).into();
            let v8_source = v8::Integer::new(tc_scope, source as i32).into();
            */

            let v8_new_bs = v8::Boolean::new(tc_scope, new_bs).into();

            let global = context.global(tc_scope).into();
            let js_recv_cb = state
                .js_recv_cb
                .as_ref()
                .map(|cb| v8::Local::new(tc_scope, cb))
                .unwrap();
            drop(state);
            js_recv_cb.call(
                tc_scope,
                global,
                //&[v8_stype, v8_session, v8_source, v8_msg, v8_sz],
                &[v8_new_bs],
            );
        }

        self.check_dyn_import();
        self.check_promise_exceptions()?;
        Ok(true)
    }
}

const SHARED_MIN_SZ: usize = 128;
const SHARED_MAX_SZ: usize = 64 * 1024;
impl JsRuntimeState {
    pub fn create_inspector(&mut self, scope: &mut v8::HandleScope) {
        if self.inspector.is_none() {
            let context = self.global_context.clone().unwrap();
            self.inspector.replace(Inspector::new(scope, context));
        }
    }

    pub fn inspector_alloc_session(&mut self) -> i64 {
        let inspector = &mut self.inspector.as_mut().unwrap();
        inspector.next_session_id = inspector.next_session_id + 1;
        return inspector.next_session_id;
    }

    pub fn inspector_ptr(&mut self) -> *mut Inspector {
        let inspector = &mut self.inspector.as_mut().unwrap();
        return inspector.self_ptr;
    }

    pub fn inspector_add_session(
        &mut self,
        session_id: i64,
        session: Box<dyn v8::inspector::ChannelImpl>,
        v8_session: *mut v8::inspector::V8InspectorSession,
    ) {
        let inspector = &mut self.inspector.as_mut().unwrap();
        inspector.sessions.insert(session_id, session);
        inspector.v8_sessions.insert(session_id, v8_session);

        let runtime = unsafe { &mut *self.runtime };
        runtime.inspector_session_len = inspector.sessions.len();
    }

    pub fn inspector_del_session(&mut self, session_id: i64) {
        let inspector = &mut self.inspector.as_mut().unwrap();
        inspector.sessions.remove(&session_id);
        inspector.v8_sessions.remove(&session_id);

        let runtime = unsafe { &mut *self.runtime };
        runtime.inspector_session_len = inspector.sessions.len();
    }

    pub fn set_pause_resume_proxy(&mut self, pause_proxy_addr: &str, resume_proxy_addr: &str) {
        let inspector = &mut self.inspector.as_mut().unwrap();
        inspector.pause_proxy_addr.replace(pause_proxy_addr.to_owned());
        inspector.resume_proxy_addr.replace(resume_proxy_addr.to_owned());
    }

    pub fn get_shared_bs(&mut self, scope: &mut v8::HandleScope, sz: usize) -> bool {
        let shared_bs = &self.shared_bs;
        let mut new_bs = false;
        let _bs = match shared_bs {
            Some(bs) if bs.byte_length() >= sz => bs,
            _ => {
                let mut alloc_sz = SHARED_MIN_SZ;
                if let Some(bs) = shared_bs {
                    alloc_sz = if bs.byte_length() > 0 { bs.byte_length() * 2 } else { SHARED_MIN_SZ };
                }
                alloc_sz = (sz as f32 / alloc_sz as f32).ceil() as usize * alloc_sz;
                if alloc_sz >= SHARED_MAX_SZ {
                    alloc_sz = (sz as f32 / SHARED_MIN_SZ as f32).ceil() as usize * SHARED_MIN_SZ;
                } else if alloc_sz < SHARED_MIN_SZ {
                    alloc_sz = SHARED_MIN_SZ;
                }

                //let mut buf = Vec::new();
                //buf.resize(alloc_sz, 0);
                //let bs = v8::SharedArrayBuffer::new_backing_store_from_boxed_slice(buf.into_boxed_slice(),);
                let bs = v8::SharedArrayBuffer::new_backing_store(scope, alloc_sz);
                new_bs = true;

                self.shared_bs = Some(bs.make_shared());
                self.shared_bs.as_ref().unwrap()
            }
        };
        new_bs
    }
}
