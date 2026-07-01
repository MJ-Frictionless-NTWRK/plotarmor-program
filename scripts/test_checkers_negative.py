#!/usr/bin/env python3
"""
Negative tests for verify_calls.py and check_integrity.py.

Each test feeds a known-bad TypeScript fixture to a checker and asserts
that the checker exits non-zero. A final sanity pass confirms a known-good
fixture still exits zero.

Run with:
  python3 scripts/test_checkers_negative.py
"""
import os
import subprocess
import sys
import tempfile

SCRIPTS_DIR = os.path.dirname(os.path.abspath(__file__))
VERIFY_CALLS = os.path.join(SCRIPTS_DIR, "verify_calls.py")
CHECK_INTEGRITY = os.path.join(SCRIPTS_DIR, "check_integrity.py")

GOOD_REGISTER = """.registerWorkClaim(rawHash, contentKind, claimKind, totalShares, thresholdShares, linkNonce, anchorNonce, anchorModeArg, externalRefHash)
  .accountsStrict({ a: 1 })
  .rpc();"""

GOOD_ADD_VERSION = """.addVersion(rawHash, contentKind, linkNonce, anchorNonce, anchorModeArg, expectedPreviousLink, externalRefHash)
  .accountsStrict({ a: 1 })
  .rpc();"""

GOOD_EVIDENCE = """.anchorEvidenceContract(rawHash, contractKind, anchorNonce, anchorModeArg, assertedWorkClaim, externalRefHash)
  .accountsStrict({ a: 1 })
  .rpc();"""

GOOD_AUTHORIZED = """.anchorAuthorizedContract(rawHash, contractKind, anchorNonce, anchorModeArg, externalRefHash)
  .accountsStrict({ a: 1 })
  .rpc();"""

GOOD_ALL = "\n".join([GOOD_REGISTER, GOOD_ADD_VERSION, GOOD_EVIDENCE, GOOD_AUTHORIZED])


def run(checker, content):
    with tempfile.NamedTemporaryFile(suffix=".ts", mode="w", delete=False) as f:
        f.write(content)
        path = f.name
    try:
        result = subprocess.run(
            [sys.executable, checker, path],
            capture_output=True,
            text=True,
        )
        return result.returncode, result.stdout + result.stderr
    finally:
        os.unlink(path)


def assert_fail(name, checker, content):
    code, out = run(checker, content)
    if code == 0:
        print(f"  FAIL  {name}")
        print(f"        Expected non-zero exit but got 0")
        print(f"        Output: {out.strip()[:200]}")
        return False
    print(f"  PASS  {name}")
    return True


def assert_pass(name, checker, content):
    code, out = run(checker, content)
    if code != 0:
        print(f"  FAIL  {name}")
        print(f"        Expected exit 0 but got {code}")
        print(f"        Output: {out.strip()[:200]}")
        return False
    print(f"  PASS  {name}")
    return True


def main():
    results = []

    print("=== verify_calls.py negative tests ===")

    # registerWorkClaim with 8 args (missing externalRefHash)
    bad_8 = """.registerWorkClaim(rawHash, contentKind, claimKind, totalShares, thresholdShares, linkNonce, anchorNonce, anchorModeArg)
  .accountsStrict({}).rpc();"""
    results.append(assert_fail(
        "registerWorkClaim 8 args (expected 9) → mismatch",
        VERIFY_CALLS, bad_8,
    ))

    # addVersion with 8 args (one too many)
    bad_8v = """.addVersion(rawHash, contentKind, linkNonce, anchorNonce, anchorModeArg, expectedPreviousLink, externalRefHash, extra)
  .accountsStrict({}).rpc();"""
    results.append(assert_fail(
        "addVersion 8 args (expected 7) → mismatch",
        VERIFY_CALLS, bad_8v,
    ))

    # anchorEvidenceContract with 5 args (missing externalRefHash)
    bad_5e = """.anchorEvidenceContract(rawHash, contractKind, anchorNonce, anchorModeArg, assertedWorkClaim)
  .accountsStrict({}).rpc();"""
    results.append(assert_fail(
        "anchorEvidenceContract 5 args (expected 6) → mismatch",
        VERIFY_CALLS, bad_5e,
    ))

    # anchorAuthorizedContract with 4 args (missing externalRefHash)
    bad_4a = """.anchorAuthorizedContract(rawHash, contractKind, anchorNonce, anchorModeArg)
  .accountsStrict({}).rpc();"""
    results.append(assert_fail(
        "anchorAuthorizedContract 4 args (expected 5) → mismatch",
        VERIFY_CALLS, bad_4a,
    ))

    # Sanity: all correct → exit 0
    results.append(assert_pass(
        "sanity: all correct arg counts → pass",
        VERIFY_CALLS, GOOD_ALL,
    ))

    print()
    print("=== check_integrity.py negative tests ===")

    # Missing .accountsStrict / .accounts
    bad_no_accounts = """.registerWorkClaim(rawHash, contentKind, claimKind, totalShares, thresholdShares, linkNonce, anchorNonce, anchorModeArg, externalRefHash)
  .rpc();"""
    results.append(assert_fail(
        "registerWorkClaim missing .accountsStrict → fail",
        CHECK_INTEGRITY, bad_no_accounts,
    ))

    # Missing .rpc() / .instruction() terminator
    bad_no_terminator = """.addVersion(rawHash, contentKind, linkNonce, anchorNonce, anchorModeArg, expectedPreviousLink, externalRefHash)
  .accountsStrict({ a: 1 });"""
    results.append(assert_fail(
        "addVersion missing terminator → fail",
        CHECK_INTEGRITY, bad_no_terminator,
    ))

    # Wrong arg count (triggers both ARGS mismatch and other checks)
    bad_args_integrity = """.anchorEvidenceContract(rawHash, contractKind, anchorNonce, anchorModeArg)
  .accountsStrict({ a: 1 })
  .rpc();"""
    results.append(assert_fail(
        "anchorEvidenceContract 4 args (expected 6) → mismatch",
        CHECK_INTEGRITY, bad_args_integrity,
    ))

    # Missing both accounts and terminator
    bad_bare = """.anchorAuthorizedContract(rawHash, contractKind, anchorNonce, anchorModeArg, externalRefHash);"""
    results.append(assert_fail(
        "anchorAuthorizedContract bare call (no accounts, no terminator) → fail",
        CHECK_INTEGRITY, bad_bare,
    ))

    # Sanity: fully correct call → exit 0
    results.append(assert_pass(
        "sanity: all correct → pass",
        CHECK_INTEGRITY, GOOD_ALL,
    ))

    print()
    passed = sum(results)
    total = len(results)
    print(f"Results: {passed}/{total} passed")
    if passed < total:
        print("SOME TESTS FAILED")
        sys.exit(1)
    else:
        print("ALL NEGATIVE TESTS PASSED")
        sys.exit(0)


if __name__ == "__main__":
    main()
