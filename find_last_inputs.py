import json

path = r'C:\Users\Thanushka\.gemini\antigravity-ide\brain\0c7e6145-98ab-4d01-a991-55cae5db97f5\.system_generated\logs\transcript_full.jsonl'
with open(path, 'r', encoding='utf-8') as f:
    for line in f:
        try:
            d = json.loads(line)
            idx = d.get('step_index')
            if idx and 25598 <= idx <= 26080:
                for c in d.get('tool_calls', []):
                    if c.get('name') in ['replace_file_content', 'write_to_file', 'multi_replace_file_content']:
                        print(idx, c.get('name'), c.get('args', {}).get('TargetFile'))
        except Exception:
            pass

