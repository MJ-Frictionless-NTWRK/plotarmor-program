#!/usr/bin/env python3
"""
Verify every Anchor instruction call in measure_devnet.ts has the correct
number of arguments after the external_ref_hash change.

Expected argument counts (including the new trailing external_ref_hash):
  registerWorkClaim:        9  (raw_hash, content_kind, claim_kind, total_shares,
                                 threshold_shares, link_nonce, anchor_nonce,
                                 anchor_mode_arg, external_ref_hash)
  addVersion:               7  (raw_hash, content_kind, link_nonce, anchor_nonce,
                                 anchor_mode_arg, expected_previous_link,
                                 external_ref_hash)
  anchorEvidenceContract:   6  (raw_contract_hash, contract_kind, anchor_nonce,
                                 anchor_mode_arg, asserted_work_claim,
                                 external_ref_hash)
  anchorAuthorizedContract: 5  (raw_contract_hash, contract_kind, anchor_nonce,
                                 anchor_mode_arg, external_ref_hash)
"""
import os
import re
import sys

EXPECTED = {
    "registerWorkClaim": 9,
    "addVersion": 7,
    "anchorEvidenceContract": 6,
    "anchorAuthorizedContract": 5,
}

def check_file(path):
    with open(path, "r") as f:
        text = f.read()

    # Find each instruction call. We match the method name followed by '(' and
    # then capture balanced parentheses content (handles multi-line).
    results = []
    for method in EXPECTED:
        # Find all occurrences of .method(
        for m in re.finditer(r"\." + method + r"\(", text):
            start = m.end() - 1  # position of the opening paren
            # Walk forward to find the matching close paren.
            depth = 0
            i = start
            while i < len(text):
                c = text[i]
                if c == "(":
                    depth += 1
                elif c == ")":
                    depth -= 1
                    if depth == 0:
                        break
                i += 1
            call_body = text[start + 1 : i]
            # Count top-level commas (depth 0 within this call).
            depth = 0
            args = 1 if call_body.strip() else 0
            in_str = None
            for c in call_body:
                if in_str:
                    if c == in_str:
                        in_str = None
                    continue
                if c in "\"'`":
                    in_str = c
                elif c in "([{":
                    depth += 1
                elif c in ")]}":
                    depth -= 1
                elif c == "," and depth == 0:
                    args += 1
            # Account for trailing comma (e.g. "a, b,") which would overcount by 1.
            stripped = call_body.rstrip()
            if stripped.endswith(","):
                args -= 1
            line_no = text[:start].count("\n") + 1
            expected = EXPECTED[method]
            ok = args == expected
            results.append((line_no, method, args, expected, ok))

    results.sort()
    all_ok = True
    print(f"\nFile: {path}")
    print(f"{'LINE':>6}  {'METHOD':<26} {'ARGS':>4} {'EXP':>4}  STATUS")
    print("-" * 60)
    for line_no, method, args, expected, ok in results:
        status = "OK" if ok else "*** MISMATCH ***"
        if not ok:
            all_ok = False
        print(f"{line_no:>6}  {method:<26} {args:>4} {expected:>4}  {status}")

    print("-" * 60)
    print(f"Total calls checked: {len(results)}")
    if all_ok:
        print("ALL CALLS HAVE CORRECT ARGUMENT COUNTS")
    else:
        print("SOME CALLS ARE WRONG - SEE MISMATCHES ABOVE")
    return all_ok

def main():
    paths = sys.argv[1:] if len(sys.argv) > 1 else ["scripts/measure_devnet.ts"]

    all_ok = True
    for path in paths:
        if not os.path.exists(path):
            print(f"File not found: {path}")
            all_ok = False
            continue
        ok = check_file(path)
        if not ok:
            all_ok = False

    sys.exit(0 if all_ok else 1)

if __name__ == "__main__":
    main()
