use std::collections::HashMap;
use std::fmt;

use rusty_v8 as v8;

pub type ModuleId = i32;

#[derive(Debug, Clone, Eq, Hash, PartialEq, serde::Serialize)]
pub struct ModuleSpecifier(String);

impl ModuleSpecifier {
    pub fn new(path: String) -> Self {
        Self(path)
    }
    pub fn as_str(&self) -> &str {
        self.0.as_str()
    }
}

#[derive(Debug, Eq, PartialEq)]
pub struct ModuleSource {
    pub code: String,
    pub module_url_specified: String,
    pub module_url_found: String,
}

pub struct ModuleInfo {
    pub main: bool,
    pub name: String,
    pub handle: v8::Global<v8::Module>,
    pub import_specifiers: Vec<ModuleSpecifier>,
}

/// A symbolic module entity.
enum SymbolicModule {
    /// This module is an alias to another module.
    /// This is useful such that multiple names could point to
    /// the same underlying module (particularly due to redirects).
    Alias(String),
    /// This module associates with a V8 module by id.
    Mod(ModuleId),
}

#[derive(Default)]
/// Alias-able module name map
struct ModuleNameMap {
    inner: HashMap<String, SymbolicModule>,
}

impl ModuleNameMap {
    pub fn new() -> Self {
        ModuleNameMap {
            inner: HashMap::new(),
        }
    }

    /// Get the id of a module.
    /// If this module is internally represented as an alias,
    /// follow the alias chain to get the final module id.
    pub fn get(&self, name: &str) -> Option<ModuleId> {
        let mut mod_name = name;
        loop {
            let cond = self.inner.get(mod_name);
            match cond {
                Some(SymbolicModule::Alias(target)) => {
                    mod_name = target;
                }
                Some(SymbolicModule::Mod(mod_id)) => {
                    return Some(*mod_id);
                }
                _ => {
                    return None;
                }
            }
        }
    }

    /// Insert a name assocated module id.
    pub fn insert(&mut self, name: String, id: ModuleId) {
        self.inner.insert(name, SymbolicModule::Mod(id));
    }

    /// Create an alias to another module.
    pub fn alias(&mut self, name: String, target: String) {
        self.inner.insert(name, SymbolicModule::Alias(target));
    }

    /// Check if a name is an alias to another module.
    #[cfg(test)]
    pub fn is_alias(&self, name: &str) -> bool {
        let cond = self.inner.get(name);
        matches!(cond, Some(SymbolicModule::Alias(_)))
    }
}

/// A collection of JS modules.
#[derive(Default)]
pub struct Modules {
    pub(crate) info: HashMap<ModuleId, ModuleInfo>,
    by_name: ModuleNameMap,
}

impl Modules {
    pub fn new() -> Modules {
        Self {
            info: HashMap::new(),
            by_name: ModuleNameMap::new(),
        }
    }

    pub fn get_id(&self, name: &str) -> Option<ModuleId> {
        self.by_name.get(name)
    }

    pub fn get_children(&self, id: ModuleId) -> Option<&Vec<ModuleSpecifier>> {
        self.info.get(&id).map(|i| &i.import_specifiers)
    }

    pub fn get_name(&self, id: ModuleId) -> Option<&String> {
        self.info.get(&id).map(|i| &i.name)
    }

    pub fn is_registered(&self, specifier: &ModuleSpecifier) -> bool {
        self.by_name.get(&specifier.to_string()).is_some()
    }

    pub fn register(
        &mut self,
        id: ModuleId,
        name: &str,
        main: bool,
        handle: v8::Global<v8::Module>,
        import_specifiers: Vec<ModuleSpecifier>,
    ) {
        let name = String::from(name);
        debug!("register_complete {}", name);

        self.by_name.insert(name.clone(), id);
        self.info.insert(
            id,
            ModuleInfo {
                main,
                name,
                import_specifiers,
                handle,
            },
        );
    }

    pub fn alias(&mut self, name: &str, target: &str) {
        self.by_name.alias(name.to_owned(), target.to_owned());
    }

    #[cfg(test)]
    pub fn is_alias(&self, name: &str) -> bool {
        self.by_name.is_alias(name)
    }

    pub fn get_info(&self, id: ModuleId) -> Option<&ModuleInfo> {
        if id == 0 {
            return None;
        }
        self.info.get(&id)
    }
}

impl fmt::Display for ModuleSpecifier {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        self.0.fmt(f)
    }
}
