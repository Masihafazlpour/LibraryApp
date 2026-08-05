from pathlib import Path
import re

root = Path(__file__).resolve().parent
required = [
    'index.html', 'app.js', 'config.js', 'styles.css',
    'schema.sql', 'bootstrap-first-admin.sql',
    'create-librarian.ts', 'README.md'
]
for name in required:
    path = root / name
    assert path.exists() and path.stat().st_size > 0, f'missing: {name}'

index = (root / 'index.html').read_text(encoding='utf-8')
app = (root / 'app.js').read_text(encoding='utf-8')
css = (root / 'styles.css').read_text(encoding='utf-8')
sql = (root / 'schema.sql').read_text(encoding='utf-8')
config = (root / 'config.js').read_text(encoding='utf-8')

for tab in ['dashboard', 'members', 'books', 'loans', 'reports', 'cards', 'settings']:
    assert f'data-tab="{tab}"' in index
assert 'href="styles.css"' in index
assert 'src="config.js"' in index
assert 'src="app.js"' in index
assert 'fa-IR-u-ca-persian' in app
assert "if (!loan || loan.returned_at) return null" in app
assert "loan.returned_at ? '—'" in app
assert 'overflow-x: hidden' in css
assert 'grid-template-columns: 108px minmax(0,1fr)' in css
assert 'enable row level security' in sql
for fn in ['issue_loan', 'return_loan', 'renew_loan', 'delete_loan', 'restore_backup', 'update_book_inventory']:
    assert f'function public.{fn}' in sql
assert 'SUPABASE_SERVICE_ROLE_KEY:' not in config
assert 'SUPABASE_SERVICE_ROLE_KEY' not in app
assert re.search(r"role in \('admin', 'librarian'\)", sql)

# The flat project must contain no legacy relative subdirectory path references.
for legacy in ['assets/', 'supabase/', 'tests/']:
    for text in [index, app, config]:
        assert f'\"{legacy}' not in text
        assert f"'{legacy}" not in text

print('Flat-project smoke tests passed.')
