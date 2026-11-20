#!/usr/bin/env python3
"""Small validator for GPT-compatible embedded HTML annotations."""
import argparse, re, sys
from pathlib import Path

def main():
    p = argparse.ArgumentParser()
    p.add_argument('--check', required=True)
    a = p.parse_args()
    path = Path(a.check)
    text = path.read_text(encoding='utf-8')
    if 'window.__HAE_GPT__' not in text:
        print('FAIL: missing window.__HAE_GPT__')
        return 1
    ids = re.findall(r'"id"\s*:\s*"([^"]+)"', text)
    if len(ids) != len(set(ids)):
        print('FAIL: duplicate annotation ids')
        return 1
    nums = [int(x) for x in re.findall(r'"number"\s*:\s*(\d+)', text)]
    if nums and sorted(nums) != list(range(1, len(nums)+1)):
        print('FAIL: annotation numbers are not continuous')
        return 1
    print(f'OK: {path.name}; annotations={len(ids)}')
    return 0

if __name__ == '__main__':
    sys.exit(main())
