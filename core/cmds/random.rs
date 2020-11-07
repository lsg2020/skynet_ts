// Copyright 2018-2020 the Deno authors. All rights reserved. MIT license.

use crate::error::AnyError;
use crate::serde_json::json;
use crate::serde_json::Value;
use crate::OpState;
use crate::ZeroCopyBuf;
use rand::rngs::StdRng;
use rand::thread_rng;
use rand::Rng;
use rand::SeedableRng;

pub fn init(rt: &mut crate::JsRuntime, maybe_seed: Option<u64>) {
    if let Some(seed) = maybe_seed {
        let rng = StdRng::seed_from_u64(seed);
        let op_state = rt.op_state();
        let mut state = op_state.borrow_mut();
        state.put::<StdRng>(rng);
    }
    super::reg_json_sync(rt, "op_get_random_values", op_get_random_values);
}

fn op_get_random_values(
    state: &mut OpState,
    _args: Value,
    zero_copy: &mut [ZeroCopyBuf],
) -> Result<Value, AnyError> {
    assert_eq!(zero_copy.len(), 1);
    let maybe_seeded_rng = state.try_borrow_mut::<StdRng>();
    if let Some(seeded_rng) = maybe_seeded_rng {
        seeded_rng.fill(&mut *zero_copy[0]);
    } else {
        let mut rng = thread_rng();
        rng.fill(&mut *zero_copy[0]);
    }

    Ok(json!({}))
}
