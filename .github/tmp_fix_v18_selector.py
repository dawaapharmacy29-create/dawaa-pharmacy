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
new = '''replace_all_count(
    'src/lib/salesIntelligence/persistence/batchPersistenceService.ts',
    "        productNameRaw: item.productNameRaw,\\n        productId: item.productId,\\n        quantity: item.quantity,\\n      })),",
    "        productNameRaw: item.productNameRaw,\\n        productId: item.productId,\\n        quantity: item.quantity,\\n        resolutionStatus: item.resolutionStatus,\\n      })),",
    minimum=2,
)
replace_all_count(
    'src/lib/salesIntelligence/persistence/batchPersistenceService.ts',
    "              productNameRaw: item.productNameRaw,\\n              productId: item.productId,\\n              quantity: item.quantity,\\n            })),",
    "              productNameRaw: item.productNameRaw,\\n              productId: item.productId,\\n              quantity: item.quantity,\\n              resolutionStatus: item.resolutionStatus,\\n            })),",
    minimum=2,
)
'''
count = text.count(old)
if count != 1:
    raise SystemExit(f'expected one old selector block, got {count}')
p.write_text(text.replace(old, new, 1))
print('V18 selector corrected')
