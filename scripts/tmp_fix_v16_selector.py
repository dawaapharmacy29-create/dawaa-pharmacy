from pathlib import Path

p = Path('scripts/tmp_si_v16_align.py')
text = p.read_text(encoding='utf-8')
old = '''    "    conversationCase,\\n    customerNeed,",
    "    conversationCase: effectiveConversationCase,\\n    customerNeed,",
'''
new = '''    "  return {\\n    conversationCase,\\n    customerNeed,\\n    unavailableDemand,",
    "  return {\\n    conversationCase: effectiveConversationCase,\\n    customerNeed,\\n    unavailableDemand,",
'''
count = text.count(old)
if count != 1:
    raise SystemExit(f'expected one temporary selector, got {count}')
p.write_text(text.replace(old, new, 1), encoding='utf-8')
print('temporary V16 selector narrowed safely')
