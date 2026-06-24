#!/usr/bin/env python3
"""
PlotArmor comprehensive instruction call integrity checker.

Checks every Anchor instruction call across the repo for:
1. Correct argument count (post external_ref_hash change)
2. Structural completeness (.accountsStrict/.accounts present after each call)
3. Call termination (.rpc(), .instruction(), .transaction() present)
4. No truncated or orphaned calls

Expected argument counts:
  registerWorkClaim:        9
  addVersion:               7
  anchorEvidenceContract:   6
  anchorAuthorizedContract: 5

Usage:
  python3 check_integrity.py <path_to_ts_file>
  python3 check_integrity.py scripts/measure_devnet.ts
  python3 check_integrity.py tests/plotarmor.ts
"""
import re
import sys
import os

EXPECTED_ARGS = {
    "registerWorkClaim": 9,
    "addVersion": 7,
    "anchorEvidenceContract": 6,
    "anchorAuthorizedContract": 5,
}

TERMINATORS = [".rpc(", ".instruction(", ".transaction(", ".simulate("]
ACCOUNTS_PATTERNS = [".accountsStrict(", ".accounts("]

def find_balanced(text, start):
    """Find the index of the closing paren matching the opening at start."""
    depth = 0
    i = start
    in_str = None
    while i < len(text):
        c = text[i]
        if in_str:
            if c == in_str and (i == 0 or text[i-1] != '\\'):
                in_str = None
        elif c in '"\'`':
            in_str = c
        elif c == '(':
            depth += 1
        elif c == ')':
            depth -= 1
            if depth == 0:
                return i
        i += 1
    return -1

def count_args(body):
    """Count top-level comma-separated arguments in a call body."""
    body = body.strip()
    if not body:
        return 0
    depth = 0
    in_str = None
    args = 1
    for c in body:
        if in_str:
            if c == in_str:
                in_str = None
            continue
        if c in '"\'`':
            in_str = c
        elif c in '([{':
            depth += 1
        elif c in ')]}':
            depth -= 1
        elif c == ',' and depth == 0:
            args += 1
    # trailing comma
    if body.rstrip().endswith(','):
        args -= 1
    return args

def check_file(path):
    with open(path, 'r') as f:
        text = f.read()

    issues = []
    results = []

    for method, expected_args in EXPECTED_ARGS.items():
        pattern = r'\.' + method + r'\('
        for m in re.finditer(pattern, text):
            call_start = m.end() - 1  # position of opening paren
            call_end = find_balanced(text, call_start)
            if call_end == -1:
                line_no = text[:call_start].count('\n') + 1
                issues.append(f"  LINE {line_no}: {method}() — UNCLOSED PARENTHESIS")
                continue

            body = text[call_start+1:call_end]
            actual_args = count_args(body)
            line_no = text[:call_start].count('\n') + 1

            # Check argument count
            arg_ok = actual_args == expected_args

            # Check what follows after the closing paren
            # Use 1500 chars to handle large .accountsStrict({...}) blocks
            after = text[call_end+1:call_end+1500]

            # Check for accounts
            has_accounts = any(p in after for p in ACCOUNTS_PATTERNS)

            # Check for terminator (within reasonable distance)
            has_terminator = any(p in after for p in TERMINATORS)

            # Determine status
            status_parts = []
            ok = True

            if not arg_ok:
                status_parts.append(f"ARGS {actual_args}/{expected_args} *** MISMATCH ***")
                ok = False
            else:
                status_parts.append(f"ARGS {actual_args}/{expected_args} OK")

            if not has_accounts:
                status_parts.append("NO .accounts() FOUND")
                ok = False
            else:
                status_parts.append("accounts OK")

            if not has_terminator:
                status_parts.append("NO .rpc()/.instruction() FOUND")
                ok = False
            else:
                status_parts.append("terminator OK")

            results.append((line_no, method, ok, " | ".join(status_parts)))

    results.sort()

    print(f"\nFile: {path}")
    print(f"{'LINE':>6}  {'METHOD':<26}  STATUS")
    print("-" * 80)

    all_ok = True
    for line_no, method, ok, status in results:
        marker = "" if ok else " <<<<<"
        print(f"{line_no:>6}  {method:<26}  {status}{marker}")
        if not ok:
            all_ok = False

    if issues:
        print("\nSTRUCTURAL ISSUES:")
        for issue in issues:
            print(issue)
        all_ok = False

    print("-" * 80)
    print(f"Total calls: {len(results)}")
    if all_ok:
        print("ALL CHECKS PASSED")
    else:
        print("ISSUES FOUND — see above")
    print()
    return all_ok

def main():
    if len(sys.argv) < 2:
        print("Usage: python3 check_integrity.py <file.ts> [file2.ts ...]")
        sys.exit(1)

    all_ok = True
    for path in sys.argv[1:]:
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
