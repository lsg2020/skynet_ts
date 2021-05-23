use deno_core::futures::FutureExt;
use std::cell::RefCell;
use std::pin::Pin;
use std::rc::Rc;
use std::path::Path;

#[derive(Default)]
pub struct ModuleLoader();
impl deno_core::ModuleLoader for ModuleLoader {
    fn resolve(
        &self,
        op_state: Rc<RefCell<deno_core::OpState>>,
        specifier: &str,
        referrer: &str,
        _is_main: bool,
    ) -> Result<deno_core::ModuleSpecifier, deno_core::error::AnyError> {
        let mut op_state_rc = op_state.borrow_mut();
        let skynet = op_state_rc.borrow_mut::<crate::SkynetContext>();
        let skynet = unsafe { &mut **skynet };

        for search_path in &skynet.module_search_paths {
            let search_path = search_path.replace("?", specifier);
            if Path::new(&search_path).is_file() {
                let r = deno_core::ModuleSpecifier::from_file_path(std::env::current_dir().unwrap().join(search_path));
                if let Ok(r) = r {
                    return Ok(r);
                }
            }
        }

        Ok(deno_core::resolve_import(specifier, referrer)?)
    }

    fn load(
        &self,
        _op_state: Rc<RefCell<deno_core::OpState>>,
        module_specifier: &deno_core::ModuleSpecifier,
        _maybe_referrer: Option<deno_core::ModuleSpecifier>,
        _is_dynamic: bool,
    ) -> Pin<Box<deno_core::ModuleSourceFuture>> {
        let module_specifier = module_specifier.clone();
        async move {
            let mut path = module_specifier.to_file_path().map_err(|_| {
                deno_core::error::generic_error(format!(
                    "Provided module specifier \"{}\" is not a file URL.",
                    module_specifier
                ))
            })?;

            if path.extension().is_none() {
                path = path.with_extension("js");
            }

            let code = std::fs::read_to_string(path)?;
            let module = deno_core::ModuleSource {
                code,
                module_url_specified: module_specifier.to_string(),
                module_url_found: module_specifier.to_string(),
            };
            Ok(module)
        }
        .boxed_local()
    }
}
