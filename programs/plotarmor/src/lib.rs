pub mod constants;
pub mod error;
pub mod instructions;
pub mod state;

use anchor_lang::prelude::*;

pub use constants::*;
pub use state::*;

declare_id!("HSU9d7nCkGNWmBSCmwWpTHBZCHiNFhwFC4e9M2jWFFCm");

#[program]
pub mod plotarmor {}
