from pathlib import Path

p = Path('.github/tmp_apply_v18.py')
text = p.read_text()
old = '''replace_all_count(
    'src/lib/salesIntelligence/persistence/batchPersistenceService.ts',
    "          productNameRaw: item.productNameRaw,\\n          productId: item.productId,\\n          quantity: item.quantity,\\n        })),",
    "          productNameRaw: item.productNameRaw,\\n          productId: item.productId,\\n          quantity: item.quantity,\\n          resolutionStatus: item.resolutionStatus,\\n        })),",
    minimum=2,
)
'''
new = '''import re
batch_path = ROOT / 'src/lib/salesIntelligence/persistence/batchPersistenceService.ts'
batch_text = batch_path.read_text()
pattern = re.compile(
    r'(?P<indent>[ \\t]*)productNameRaw: item\\.productNameRaw,\\n'
    r'(?P=indent)productId: item\\.productId,\\n'
    r'(?P=indent)quantity: item\\.quantity,\\n'
)

def add_resolution_status(match):
    indent = match.group('indent')
    return (
        f'{indent}productNameRaw: item.productNameRaw,\\n'
        f'{indent}productId: item.productId,\\n'
        f'{indent}quantity: item.quantity,\\n'
        f'{indent}resolutionStatus: item.resolutionStatus,\\n'
    )

batch_text, batch_count = pattern.subn(add_resolution_status, batch_text)
if batch_count != 4:
    raise SystemExit(f'batchPersistenceService.ts: expected exactly 4 active-item mappings, got {batch_count}')
batch_path.write_text(batch_text)
'''
count = text.count(old)
if count != 1:
    raise SystemExit(f'expected one original batch selector block, got {count}')
p.write_text(text.replace(old, new, 1))
print('V18 selector corrected structurally')
