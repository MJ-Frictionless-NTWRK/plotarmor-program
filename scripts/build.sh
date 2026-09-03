#!/usr/bin/env bash
#
# Pinned SBF build wrapper for the plotarmor program.
#
# WHY THIS EXISTS
# The two build paths in this repo used to select different compilers and
# silently uninstall each other's rustup toolchain:
#   anchor build / anchor test  ->  platform-tools v1.52
#   cargo build-sbf             ->  platform-tools v1.53 (Solana CLI 4.0.1 default)
# Identical source under the two produced binaries differing by about 16KB of
# .text. This script makes the cargo path match the anchor path.
#
# WHY v1.52 AND NOT v1.53
# anchor-cli 1.0.1 passes its own --tools-version to cargo-build-sbf and pins
# v1.52. It cannot be overridden: `anchor build -- --tools-version v1.53` fails
# with "the argument '--tools-version' was provided more than once". So v1.52 is
# the only value BOTH paths can agree on today. It is also the version that
# produced the currently deployed devnet binary, which therefore stays
# reproducible. See CLAUDE.md, "Build and deploy configuration".
#
# THE ANCHOR PIN LIVES IN Anchor.toml: anchor_version = "1.0.1". Because anchor
# derives the tools version from its own release, pinning anchor-cli is what
# pins platform-tools for the anchor path. If anchor_version is ever changed,
# re-run `scripts/build.sh --check` and update PLATFORM_TOOLS_VERSION to match.
#
# USE THIS INSTEAD OF calling cargo build-sbf directly.
#
# Prerequisites: solana CLI (cargo-build-sbf), anchor-cli, rustup.
#
# Usage:
#   scripts/build.sh                 devnet artifact  -> target/deploy
#   scripts/build.sh --mainnet       mainnet-featured -> target/deploy-mainnet
#   scripts/build.sh --anchor        anchor build (IDL + types); already pinned
#   scripts/build.sh --check         report the pin and what each path selects
#   scripts/build.sh --print-version echo the pinned version and exit
#
# Extra arguments are forwarded to the underlying build command.

set -euo pipefail

# THE PIN. Changing this changes the deployed bytes. Must equal the tools
# version that the pinned anchor-cli in Anchor.toml selects, or the two paths
# diverge again.
PLATFORM_TOOLS_VERSION="v1.52"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
MANIFEST="${REPO_ROOT}/programs/plotarmor/Cargo.toml"

MODE="devnet"
case "${1:-}" in
  --mainnet)       MODE="mainnet"; shift ;;
  --anchor)        MODE="anchor";  shift ;;
  --check)         MODE="check";   shift ;;
  --print-version) echo "${PLATFORM_TOOLS_VERSION}"; exit 0 ;;
esac

if [ "${MODE}" = "check" ]; then
  echo "pin (scripts/build.sh)   : ${PLATFORM_TOOLS_VERSION}"
  echo "anchor_version (Anchor.toml): $(grep -oP '(?<=anchor_version = ")[^"]+' "${REPO_ROOT}/Anchor.toml" || echo unset)"
  echo "anchor-cli installed     : $(anchor --version 2>/dev/null || echo missing)"
  echo "cargo-build-sbf default  : $(cargo build-sbf --version 2>/dev/null | grep -i platform-tools || echo unknown)"
  echo "rustup sbf toolchain now : $(rustup toolchain list 2>/dev/null | grep sbpf || echo none)"
  echo
  echo "The rustup line reflects whichever path ran last; it is not the pin."
  echo "A cold build is the only way to confirm what a path actually used."
  exit 0
fi

echo "platform-tools pin: ${PLATFORM_TOOLS_VERSION}  (mode: ${MODE})"

# STALE-ARTIFACT GUARD. Cargo's fingerprint does NOT track the platform-tools
# version, so after a toolchain change it happily reports "Finished in 1.3s",
# recompiles nothing, and leaves an artifact built by the OTHER compiler in
# place. Observed repeatedly. A stamp file is the only reliable detector: if the
# recorded version differs from the pin, wipe the SBF intermediate dir so the
# next build is genuinely cold.
TARGET_DIR="${CARGO_TARGET_DIR:-${REPO_ROOT}/target}"
STAMP="${TARGET_DIR}/.platform-tools-pin"
PREVIOUS="$(cat "${STAMP}" 2>/dev/null || echo none)"
if [ "${PREVIOUS}" != "${PLATFORM_TOOLS_VERSION}" ]; then
  if [ -d "${TARGET_DIR}/sbpf-solana-solana" ]; then
    echo "toolchain changed (${PREVIOUS} -> ${PLATFORM_TOOLS_VERSION}); forcing a cold SBF rebuild"
    rm -rf "${TARGET_DIR}/sbpf-solana-solana"
  fi
fi

case "${MODE}" in
  devnet)
    cargo build-sbf \
      --manifest-path "${MANIFEST}" \
      --tools-version "${PLATFORM_TOOLS_VERSION}" \
      --sbf-out-dir "${REPO_ROOT}/target/deploy" "$@"
    ;;
  mainnet)
    cargo build-sbf \
      --manifest-path "${MANIFEST}" \
      --features mainnet \
      --tools-version "${PLATFORM_TOOLS_VERSION}" \
      --sbf-out-dir "${REPO_ROOT}/target/deploy-mainnet" "$@"
    ;;
  anchor)
    # No --tools-version here on purpose: anchor passes its own and rejects a
    # second one. anchor-cli 1.0.1 already selects PLATFORM_TOOLS_VERSION.
    ( cd "${REPO_ROOT}" && anchor build "$@" )
    ;;
esac

mkdir -p "${TARGET_DIR}"
echo "${PLATFORM_TOOLS_VERSION}" > "${STAMP}"
